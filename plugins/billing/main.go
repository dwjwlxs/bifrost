package billing

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	bconfig "github.com/dwjwlxs/bifrost/plugins/billing/internal/config"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/handlers"
	bpayment "github.com/dwjwlxs/bifrost/plugins/billing/internal/services/payment"
	"github.com/dwjwlxs/bifrost/plugins/billing/pkg/cache"
	"github.com/dwjwlxs/bifrost/plugins/billing/store"
	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
)

const PluginName = bconfig.PluginName

// BillingPlugin 实现 LLMPlugin 接口，提供 billing budget 的检查和扣费
type BillingPlugin struct {
	pluginConfig *bconfig.BillingPluginConfig
	config       *lib.Config

	mu           sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
	logger       schemas.Logger
	configStore  configstore.ConfigStore
	modelCatalog *modelcatalog.ModelCatalog
	budgetStore  store.BudgetStore
	checker      *BillingBudgetChecker
	tracker      *UsageTracker
	initialized  bool
}

// NewBillingPlugin 创建 billing 插件
func NewBillingPlugin(
	config *lib.Config,
	logger schemas.Logger,
	modelCatalog *modelcatalog.ModelCatalog,
) (*BillingPlugin, error) {
	var pluginConfig *bconfig.BillingPluginConfig
	var err error
	pluginConfig, err = bconfig.LoadConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to load billing plugin config: %w", err)
	}

	// migration
	if err := TriggerMigrations(context.Background(), config.ConfigStore); err != nil {
		return nil, fmt.Errorf("failed to trigger migrations: %w", err)
	}
	config.Logger.Info("billing migrations completed")

	p := &BillingPlugin{
		pluginConfig: pluginConfig,
		config:       config,

		logger:       logger,
		configStore:  config.ConfigStore,
		modelCatalog: modelCatalog,
	}

	// 初始化存储层：优先用 cache 配置创建 Redis client，否则用内存
	var budgetStore store.BudgetStore
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	if pluginConfig != nil && pluginConfig.Cache != nil && pluginConfig.Cache.Redis != nil {
		redisClient, err := cache.NewRedisClient(ctx, pluginConfig.Cache.Redis)
		if err != nil {
			logger.Error("failed to create Redis client, falling back to memory: %v", err)
			return nil, err
		}
		budgetStore, err = store.NewRedisBudgetStore(ctx, logger, redisClient)
		if err != nil {
			redisClient.Close()
			logger.Error("failed to create Redis budget store, falling back to memory: %v", err)
			return nil, err
		}
	}

	p.budgetStore = budgetStore
	p.checker = NewBillingBudgetChecker(budgetStore, logger)

	// 初始化 tracker
	dumpInterval := 10 * time.Second
	if pluginConfig != nil && pluginConfig.DumpIntervalSec > 0 {
		dumpInterval = time.Duration(pluginConfig.DumpIntervalSec) * time.Second
	}
	p.tracker = NewUsageTracker(budgetStore, p.configStore, logger, dumpInterval)

	p.init(ctx)
	return p, nil
}

// Init 初始化插件：从 DB 加载数据到 Redis，启动后台 worker
func (p *BillingPlugin) init(ctx context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.initialized {
		return
	}

	// 从 DB 加载 billing 数据到存储
	if err := p.loadFromDatabase(ctx); err != nil {
		log.Fatalf("failed to load billing data from database: %v", err)
		return
	}

	// 启动后台 worker
	p.tracker.Start(ctx)

	p.initialized = true
	p.ctx = ctx
	p.logger.Info("billing plugin initialized")
	return
}

// --- LLMPlugin 接口实现 ---

func (p *BillingPlugin) GetName() string {
	return "billing"
}

func (p *BillingPlugin) Cleanup() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.tracker != nil {
		p.tracker.Stop()
	}

	// 最终 dump
	if p.budgetStore != nil {
		p.dumpToDatabase(p.ctx)
		p.budgetStore.Close()
	}

	p.initialized = false
	p.cancel()
	p.logger.Info("billing plugin shutdown")
	return nil
}

func (p *BillingPlugin) PreLLMHook(ctx *schemas.BifrostContext, request *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	// 从 context 获取 VK
	vkValue := ""
	if vk, ok := ctx.Value(schemas.BifrostContextKeyVirtualKey).(string); ok {
		vkValue = vk
	}

	// 必须有 VK
	if vkValue == "" {
		return nil, &schemas.LLMPluginShortCircuit{
			Error: BifrostErrVKRequired,
		}, nil
	}

	// 从存储获取 VK 层级数据
	vkData, err := p.budgetStore.GetVKHierarchy(ctx, vkValue)
	if err != nil {
		p.logger.Error("billing PreLLMHook: failed to get VK hierarchy: %v", err)
		return request, nil, err
	}
	if vkData == nil {
		return nil, &schemas.LLMPluginShortCircuit{
			Error: BifrostErrVKInvalid,
		}, nil
	}

	// 收集 VK 层级的所有 billing budget
	budgets, err := p.budgetStore.CollectBillingBudgets(ctx, vkData)
	if err != nil {
		p.logger.Error("billing PreLLMHook: failed to collect billing budgets: %v", err)
		return request, nil, err
	}

	if len(budgets) == 0 {
		return request, &schemas.LLMPluginShortCircuit{
			Error: BifrostErrBillingBudgetExceeded,
		}, nil
	}

	// Check（OR 逻辑）——任意 budget 有余额则允许
	decision, err := p.checker.Check(ctx, budgets, nil)
	if err != nil {
		p.logger.Error("billing PreLLMHook: check failed: %v", err)
		return request, nil, err
	}

	if decision == DecisionBudgetExceeded {
		// 返回用户级拒绝（LLMPluginShortCircuit），而非系统 error
		return nil, &schemas.LLMPluginShortCircuit{
			Error: BifrostErrBillingBudgetExceeded,
		}, nil
	}

	return request, nil, nil
}

func (p *BillingPlugin) PostLLMHook(ctx *schemas.BifrostContext, response *schemas.BifrostResponse, bifrostErr *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	if response == nil || bifrostErr != nil {
		return response, bifrostErr, nil
	}

	// 从 context 获取 VK
	vkValue := ""
	if vk, ok := ctx.Value(schemas.BifrostContextKeyVirtualKey).(string); ok {
		vkValue = vk
	}

	if vkValue == "" {
		return response, bifrostErr, nil
	}

	// 从 response 获取 provider/model 信息计算 cost
	_, provider, _, _ := bifrost.GetResponseFields(response, bifrostErr)
	cost := p.calculateCostFromResponse(response, provider)
	if cost <= 0 {
		return response, bifrostErr, nil
	}

	// 从存储获取 VK 层级数据
	vkData, err := p.budgetStore.GetVKHierarchy(ctx, vkValue)
	if err != nil || vkData == nil {
		p.logger.Error("billing PostLLMHook: failed to get VK hierarchy: %v", err)
		return response, bifrostErr, nil
	}

	// 收集 billing budgets
	budgets, err := p.budgetStore.CollectBillingBudgets(ctx, vkData)
	if err != nil {
		p.logger.Error("billing PostLLMHook: failed to collect billing budgets: %v", err)
		return response, bifrostErr, err
	}
	if len(budgets) == 0 {
		return response, bifrostErr, nil
	}

	// Deduct（混合 OR 逻辑，通过 BudgetStore 扣费）
	charged, err := p.checker.Deduct(ctx, budgets, cost)
	if err != nil {
		p.logger.Error("billing PostLLMHook: deduct failed for VK %s: %v", vkValue, err)
	} else if len(charged) > 0 {
		p.logger.Debug("billing PostLLMHook: deducted from %d budgets for VK %s", len(charged), vkValue)
	}

	return response, bifrostErr, nil
}

// calculateCostFromResponse 使用 modelCatalog 计算请求成本
func (p *BillingPlugin) calculateCostFromResponse(response *schemas.BifrostResponse, _ schemas.ModelProvider) float64 {
	if p.modelCatalog == nil {
		return 0
	}
	return p.modelCatalog.CalculateCost(response, nil)
}

// loadFromDatabase 从 DB 加载所有 billing 相关数据到存储
func (p *BillingPlugin) loadFromDatabase(ctx context.Context) error {
	// 1. 加载所有 billing 类型的 budget（DB 层过滤）
	budgets, err := p.configStore.GetBudgetsByType(ctx, configstoreTables.BudgetTypeBilling)
	if err != nil {
		return fmt.Errorf("failed to load budgets: %w", err)
	}

	for i := range budgets {
		b := &budgets[i]
		if err := p.budgetStore.Set(ctx, b.ID, b); err != nil {
			p.logger.Error("failed to load budget %s to store: %v", b.ID, err)
		}
	}

	// 2. 加载 VK 层级缓存
	if err := p.loadVKHierarchy(ctx); err != nil {
		p.logger.Error("failed to load VK hierarchy: %v", err)
		// 非致命错误，VK 缓存会在请求时按需加载
	}

	p.logger.Info("loaded billing data from database")
	return nil
}

// loadVKHierarchy 加载 VK 层级关系到缓存
func (p *BillingPlugin) loadVKHierarchy(ctx context.Context) error {
	vks, err := p.configStore.GetVirtualKeys(ctx)
	if err != nil {
		return err
	}

	for _, vk := range vks {
		data := &store.VKHierarchyData{
			ID:         vk.ID,
			TeamID:     vk.TeamID,
			CustomerID: vk.CustomerID,
			UserID:     vk.UserID,
		}
		if err := p.budgetStore.SetVKHierarchy(ctx, vk.Value, data); err != nil {
			p.logger.Error("failed to cache VK %s: %v", vk.ID, err)
		}
	}

	return nil
}

// dumpToDatabase 将存储中的 budget 数据 dump 到 DB
func (p *BillingPlugin) dumpToDatabase(ctx context.Context) {
	// 通过 tracker 实现
	if p.tracker != nil {
		if err := p.tracker.DumpBudgets(ctx); err != nil {
			p.logger.Error("failed to dump budgets to database: %v", err)
		}
	}
}

// GetBudgetStore 返回 BudgetStore（供 handler 和 service 使用）
func (p *BillingPlugin) GetBudgetStore() store.BudgetStore {
	return p.budgetStore
}

// GetConfigStore 返回 ConfigStore
func (p *BillingPlugin) GetConfigStore() configstore.ConfigStore {
	return p.configStore
}

// budgetStoreAdapter 适配 store.BudgetStore → payment.BudgetStore
// payment.BudgetStore 只需 StoreBudgetSync，而 store.BudgetStore 有 Set 方法可以完成此工作
type budgetStoreAdapter struct {
	store store.BudgetStore
}

func (a *budgetStoreAdapter) StoreBudgetSync(ctx context.Context, budget *configstoreTables.TableBudget) error {
	return a.store.Set(ctx, budget.ID, budget)
}

// GetPaymentBudgetStore 返回适配了 payment.BudgetStore 接口的 store
func (p *BillingPlugin) GetPaymentBudgetStore() bpayment.BudgetStore {
	return &budgetStoreAdapter{store: p.budgetStore}
}

func (p *BillingPlugin) RegisterRoutes(r *router.Router, outerMiddlewares ...schemas.BifrostHTTPMiddleware) {
	// --- billing service & registry (shared across handlers) ---
	bRegistry, err := bpayment.NewGatewayRegistry(p.pluginConfig.GatewayConfig)
	if err != nil {
		p.logger.Error("failed to create billing payment gateway registry: %v", err)
		log.Fatalf("failed to create billing payment gateway registry: %v", err)
	}

	// authentication middleware
	var middlewares = make([]schemas.BifrostHTTPMiddleware, len(outerMiddlewares), len(outerMiddlewares)+1)
	copy(middlewares, outerMiddlewares)
	middlewares = append(middlewares, handlers.PlatformAuthMiddleware(p.pluginConfig))

	// --- auth handler ---
	authHandler := handlers.NewPlatformAuthHandler(p.pluginConfig)
	authHandler.RegisterRoutes(r, outerMiddlewares...)

	// --- billing core handler ---
	billingHandler := handlers.NewPackageHandler(p.pluginConfig, bRegistry, p.budgetStore, p.logger)
	billingHandler.RegisterRoutes(r, middlewares...)

	// --- platform multi-tenant handlers ---
	// Admin: org/user management
	adminHandler := handlers.NewPlatformAdminHandler(p.pluginConfig)
	adminHandler.RegisterRoutes(r, middlewares...)

	// Invitations
	invitationHandler := handlers.NewPlatformInvitationHandler(p.pluginConfig)
	invitationHandler.RegisterRoutes(r, middlewares...)

	// Teams
	teamHandler := handlers.NewPlatformTeamHandler(p.pluginConfig)
	teamHandler.RegisterRoutes(r, middlewares...)

	// Organizations
	orgHandler := handlers.NewPlatformOrgHandler(p.pluginConfig)
	orgHandler.RegisterRoutes(r, middlewares...)

	// Usage (workspace-level)
	usageHandler := handlers.NewPlatformUsageHandler(p.pluginConfig)
	usageHandler.RegisterRoutes(r, middlewares...)

	// Usage (org-level)
	orgUsageHandler := handlers.NewPlatformUsageOrgHandler(p.config)
	orgUsageHandler.RegisterRoutes(r, middlewares...)

	// Virtual keys
	vkHandler := handlers.NewPlatformVKHandler(p.pluginConfig, p.budgetStore)
	vkHandler.RegisterRoutes(r, middlewares...)

	// Price
	priceHandler := handlers.NewPlatformPriceHandler(p.pluginConfig)
	priceHandler.RegisterRoutes(r, middlewares...)
}

// GetGatewayConfig 返回 payment gateway 配置
func (p *BillingPlugin) GetGatewayConfig() *bpayment.BillingConfig {
	if p.pluginConfig == nil {
		return nil
	}
	return p.pluginConfig.GatewayConfig
}
