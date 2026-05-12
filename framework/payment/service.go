package payment

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// BudgetStore is the subset of GovernanceStore needed by BillingService to sync
// newly-created billing budgets into the in-memory budgets map.
type BudgetStore interface {
	StoreBudget(ctx context.Context, budget *tables.TableBudget)
}

// BillingService handles order, recharge, package, and purchase business logic.
type BillingService struct {
	db          *gorm.DB
	registry    *GatewayRegistry
	budgetStore BudgetStore
}

// NewBillingService creates a new BillingService with a GatewayRegistry and BudgetStore.
func NewBillingService(db *gorm.DB, registry *GatewayRegistry, budgetStore BudgetStore) *BillingService {
	return &BillingService{db: db, registry: registry, budgetStore: budgetStore}
}

// ---------------------------------------------------------------------------
// Recharge (Epic I-C)
// ---------------------------------------------------------------------------

// CreateRechargeOrder creates a pending recharge order and initiates payment via the gateway.
// If gatewayID is empty, uses the default gateway from the registry.
func (s *BillingService) CreateRechargeOrder(
	ctx context.Context,
	userID *string,
	amount float64,
	credits float64,
	opts PaymentOptions,
	tenantType tables.TenantType,
	tenantID string,
	gatewayID string,
) (*tables.TablePlatformOrder, *PaymentResult, error) {
	gw, err := s.registry.Get(gatewayID)
	if err != nil {
		return nil, nil, fmt.Errorf("get payment gateway %q: %w", gatewayID, err)
	}

	order := &tables.TablePlatformOrder{
		OrderNo:       fmt.Sprintf("RCH-%s", schemas.NewID()),
		UserID:        userID,
		Type:          tables.OrderTypeRecharge,
		Amount:        amount,
		Credits:       credits,
		Status:        tables.OrderStatusPending,
		TenantType:    tenantType,
		TenantID:      tenantID,
		Gateway:       gw.GatewayID(),
		PaymentMethod: defaultPaymentMethod(gw.GatewayID()),
		ReturnURL:     opts.ReturnURL,
	}

	if err := s.db.WithContext(ctx).Create(order).Error; err != nil {
		return nil, nil, fmt.Errorf("create recharge order: %w", err)
	}

	result, err := gw.CreatePayment(ctx, order, opts)
	if err != nil {
		return order, nil, fmt.Errorf("gateway CreatePayment: %w", err)
	}

	// Persist gateway payment details to order
	s.db.WithContext(ctx).Model(order).Updates(map[string]interface{}{
		"payment_id":          result.PaymentID,
		"checkout_url":        result.CheckoutURL,
		"checkout_expires_at": parseExpiresAt(result.ExpiresAt),
	})

	return order, result, nil
}

// AdminRecharge creates a success-order and immediately credits the balance budget.
// Used when an admin manually recharges a user/customer (no payment gateway involved).
func (s *BillingService) AdminRecharge(
	ctx context.Context,
	userID *string,
	customerID *string,
	amount float64,
	credits float64,
	tenantType tables.TenantType,
	tenantID string,
) (*tables.TablePlatformOrder, error) {
	dollars := credits / 100.0
	now := time.Now()

	var order tables.TablePlatformOrder
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		order = tables.TablePlatformOrder{
			OrderNo:       fmt.Sprintf("RCH-%s", schemas.NewID()),
			UserID:        userID,
			Type:          tables.OrderTypeRecharge,
			Amount:        amount,
			Credits:       credits,
			Status:        tables.OrderStatusSuccess,
			PaymentMethod: "admin",
			PaidAt:        &now,
			TenantType:    tenantType,
			TenantID:      tenantID,
		}
		if err := tx.Create(&order).Error; err != nil {
			return fmt.Errorf("create admin order: %w", err)
		}
		var budget *tables.TableBudget
		var err error
		if customerID != nil && *customerID != "" {
			budget, err = s.findOrCreateBalanceBudget(tx, nil, tenantType, tenantID, dollars)
		} else {
			budget, err = s.findOrCreateBalanceBudget(tx, userID, tenantType, tenantID, dollars)
		}
		_ = budget // suppress unused warning if not needed
		return err
	})
	if err != nil {
		return nil, err
	}
	return &order, nil
}

// HandleRechargeSuccess marks an order as paid and credits the balance budget.
// Idempotent: if the order is already success, returns nil.
func (s *BillingService) HandleRechargeSuccess(
	ctx context.Context,
	orderID uint,
	paymentID string,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var order tables.TablePlatformOrder
		if err := tx.First(&order, orderID).Error; err != nil {
			return fmt.Errorf("find order: %w", err)
		}
		if order.Status == tables.OrderStatusSuccess {
			return nil
		}

		now := time.Now()
		order.Status = tables.OrderStatusSuccess
		order.PaymentID = paymentID
		order.PaidAt = &now
		if err := tx.Save(&order).Error; err != nil {
			return fmt.Errorf("update order: %w", err)
		}

		dollars := order.Credits / 100.0
		_, err := s.findOrCreateBalanceBudget(tx, order.UserID, order.TenantType, order.TenantID, dollars)
		return err
	})
}

// findOrCreateBalanceBudget finds an existing balance-type billing budget
// (type=billing, reset_duration="0", expires_at IS NULL) or creates a new one,
// then adds dollars to MaxLimit.
func (s *BillingService) findOrCreateBalanceBudget(tx *gorm.DB, userID *string, tenantType tables.TenantType, tenantID string, dollars float64) (*tables.TableBudget, error) {
	var ownerField, ownerID string
	ownerID = tenantID
	switch tenantType {
	case tables.TenantTypePersonal:
		ownerField = "user_id"
	case tables.TenantTypeOrganization:
		ownerField = "customer_id"
	default:
		return nil, fmt.Errorf("tenantType must be either personal or organization")
	}

	var budget tables.TableBudget
	err := tx.Where(
		ownerField+" = ? AND type = ? AND reset_duration = ? AND expires_at IS NULL",
		ownerID, tables.BudgetTypeBilling, "0",
	).First(&budget).Error

	if err == nil {
		budget.MaxLimit += dollars
		return &budget, tx.Save(&budget).Error
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	newBudget := tables.TableBudget{
		ID:            schemas.NewID(),
		Type:          tables.BudgetTypeBilling,
		MaxLimit:      dollars,
		ResetDuration: "0",
		CurrentUsage:  0,
	}
	if userID != nil {
		newBudget.UserID = &ownerID
	} else {
		newBudget.CustomerID = &ownerID
	}
	return &newBudget, tx.Create(&newBudget).Error
}

// GetBalance returns the user's billing balance.
// balance: wallet balance in USD, from billing budget with reset_duration="0" and no expiry
// packageBalance: sum of all active billing budgets (with future expiry), already in USD
func (s *BillingService) GetBalance(ctx context.Context, userID string) (balance, packageBalance float64, err error) {
	now := time.Now()

	// Wallet balance: billing budget with reset_duration="0" and no expiry (balance-type)
	// max_limit is stored in USD; convert to credits (1 credit = $0.01)
	var balanceUSD float64
	err = s.db.WithContext(ctx).
		Model(&tables.TableBudget{}).
		Where("user_id = ? AND type = ? AND reset_duration = '0' AND expires_at IS NULL", userID, tables.BudgetTypeBilling).
		Select("COALESCE(SUM(max_limit - current_usage), 0)").
		Scan(&balanceUSD).Error
	if err != nil {
		return 0, 0, fmt.Errorf("query wallet balance: %w", err)
	}
	balance = balanceUSD

	// Package balance: all billing budgets with a future expiry date, stored in USD (quota)
	var packageUSD float64
	err = s.db.WithContext(ctx).
		Model(&tables.TableBudget{}).
		Where("user_id = ? AND type = ? AND expires_at > ?", userID, tables.BudgetTypeBilling, now).
		Select("COALESCE(SUM(max_limit - current_usage), 0)").
		Scan(&packageUSD).Error
	if err != nil {
		return 0, 0, fmt.Errorf("query package balance: %w", err)
	}
	packageBalance = packageUSD

	return balance, packageBalance, nil
}

// ---------------------------------------------------------------------------\n// Package CRUD (Epic II-B-1)\n// ---------------------------------------------------------------------------\n\n// CreatePackage creates a new package product template.
func (s *BillingService) CreatePackage(ctx context.Context, pkg *tables.TablePlatformPackage) error {
	if pkg.ID == "" {
		pkg.ID = schemas.NewID()
	}
	return s.db.WithContext(ctx).Create(pkg).Error
}

// GetPackage returns a single package by ID.
func (s *BillingService) GetPackage(ctx context.Context, packageID string) (*tables.TablePlatformPackage, error) {
	var pkg tables.TablePlatformPackage
	if err := s.db.WithContext(ctx).First(&pkg, "id = ?", packageID).Error; err != nil {
		return nil, err
	}
	return &pkg, nil
}

// ListPackages returns paginated packages, optionally filtered by active status and target type.
func (s *BillingService) ListPackages(
	ctx context.Context,
	isActive *bool,
	targetType *string,
	offset, limit int,
) ([]tables.TablePlatformPackage, int64, error) {
	q := s.db.WithContext(ctx).Model(&tables.TablePlatformPackage{})
	if isActive != nil {
		q = q.Where("is_active = ?", *isActive)
	}
	if targetType != nil && *targetType != "" {
		q = q.Where("target_type = ? OR target_type = 'both'", *targetType)
	}

	var total int64
	q.Count(&total)

	var pkgs []tables.TablePlatformPackage
	err := q.Order("sort_order ASC, created_at DESC").Offset(offset).Limit(limit).Find(&pkgs).Error
	return pkgs, total, err
}

// UpdatePackage updates an existing package product template.
func (s *BillingService) UpdatePackage(ctx context.Context, packageID string, updates map[string]interface{}) error {
	result := s.db.WithContext(ctx).Model(&tables.TablePlatformPackage{}).Where("id = ?", packageID).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeletePackage soft-deletes a package by setting is_active = false.
func (s *BillingService) DeletePackage(ctx context.Context, packageID string) error {
	result := s.db.WithContext(ctx).Model(&tables.TablePlatformPackage{}).Where("id = ?", packageID).Update("is_active", false)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Package Purchase (Epic II-B-2, II-B-3)
// ---------------------------------------------------------------------------

// CreatePurchaseOrder creates a pending package-purchase order and initiates payment.
func (s *BillingService) CreatePurchaseOrder(
	ctx context.Context,
	userID *string,
	customerID *string,
	packageID string,
	opts PaymentOptions,
	tenantType tables.TenantType,
	tenantID string,
	gatewayID string,
) (*tables.TablePlatformOrder, *tables.TablePlatformPackage, *PaymentResult, error) {
	// Validate package exists and is active
	var pkg tables.TablePlatformPackage
	if err := s.db.WithContext(ctx).First(&pkg, "id = ? AND is_active = ?", packageID, true).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("package not found or inactive: %w", err)
	}

	// Get the payment gateway
	gw, err := s.registry.Get(gatewayID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("get payment gateway %q: %w", gatewayID, err)
	}

	// Validate target type
	if pkg.TargetType != "both" {
		if pkg.TargetType == "user" && (userID == nil || *userID == "") {
			return nil, nil, nil, fmt.Errorf("package is only available for users")
		}
		if pkg.TargetType == "customer" && (customerID == nil || *customerID == "") {
			return nil, nil, nil, fmt.Errorf("package is only available for customers (organizations)")
		}
	}

	// Check purchase limit
	if pkg.MaxPurchasePerUser > 0 && userID != nil && *userID != "" {
		var count int64
		s.db.WithContext(ctx).Model(&tables.TableEntityPackage{}).
			Where("user_id = ? AND package_id = ? AND status = ?", *userID, packageID, tables.EntityPackageStatusActive).
			Count(&count)
		if count >= int64(pkg.MaxPurchasePerUser) {
			return nil, nil, nil, fmt.Errorf("purchase limit reached (%d) for this package", pkg.MaxPurchasePerUser)
		}
	}

	credits := pkg.Quota
	order := &tables.TablePlatformOrder{
		OrderNo:       fmt.Sprintf("PKG-%s", schemas.NewID()),
		UserID:        userID,
		Type:          tables.OrderTypePackagePurchase,
		Amount:        pkg.Price,
		Credits:       credits,
		PackageID:     &pkg.ID,
		Status:        tables.OrderStatusPending,
		TenantType:    tenantType,
		TenantID:      tenantID,
		Gateway:       gw.GatewayID(),
		PaymentMethod: defaultPaymentMethod(gw.GatewayID()),
		ReturnURL:     opts.ReturnURL,
	}

	if err := s.db.WithContext(ctx).Create(order).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("create purchase order: %w", err)
	}

	result, err := gw.CreatePayment(ctx, order, opts)
	if err != nil {
		return order, &pkg, nil, fmt.Errorf("gateway CreatePayment: %w", err)
	}

	// Persist gateway payment details to order
	s.db.WithContext(ctx).Model(order).Updates(map[string]interface{}{
		"payment_id":          result.PaymentID,
		"checkout_url":        result.CheckoutURL,
		"checkout_expires_at": parseExpiresAt(result.ExpiresAt),
	})

	return order, &pkg, result, nil
}

// AdminPurchase creates a success-order and immediately provisions the package (no payment gateway).
func (s *BillingService) AdminPurchase(
	ctx context.Context,
	userID *string,
	customerID *string,
	packageID string,
	tenantType tables.TenantType,
	tenantID string,
) (*tables.TablePlatformOrder, *tables.TableEntityPackage, error) {
	// Validate package
	var pkg tables.TablePlatformPackage
	if err := s.db.WithContext(ctx).First(&pkg, "id = ? AND is_active = ?", packageID, true).Error; err != nil {
		return nil, nil, fmt.Errorf("package not found or inactive: %w", err)
	}

	var order tables.TablePlatformOrder
	var ep tables.TableEntityPackage
	now := time.Now()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		order = tables.TablePlatformOrder{
			OrderNo:       fmt.Sprintf("PKG-%s", schemas.NewID()),
			UserID:        userID,
			Type:          tables.OrderTypePackagePurchase,
			Amount:        pkg.Price,
			Credits:       pkg.Quota,
			PackageID:     &pkg.ID,
			Status:        tables.OrderStatusSuccess,
			PaymentMethod: "admin",
			PaidAt:        &now,
			TenantType:    tenantType,
			TenantID:      tenantID,
		}
		if err := tx.Create(&order).Error; err != nil {
			return fmt.Errorf("create admin purchase order: %w", err)
		}

		orderNo := order.OrderNo
		createdEP, err := s.provisionPackage(tx, &order, &pkg, userID, &orderNo, tenantType, tenantID)
		if err != nil {
			return err
		}
		ep = *createdEP
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &order, &ep, nil
}

// HandlePurchaseSuccess marks a purchase order as paid and provisions the package.
// Idempotent: if the order is already success, returns nil.
func (s *BillingService) HandlePurchaseSuccess(
	ctx context.Context,
	orderID uint,
	paymentID string,
) (*tables.TableEntityPackage, error) {
	var ep *tables.TableEntityPackage

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var order tables.TablePlatformOrder
		if err := tx.First(&order, orderID).Error; err != nil {
			return fmt.Errorf("find order: %w", err)
		}
		if order.Status == tables.OrderStatusSuccess {
			return nil // idempotent
		}

		now := time.Now()
		order.Status = tables.OrderStatusSuccess
		order.PaymentID = paymentID
		order.PaidAt = &now
		if err := tx.Save(&order).Error; err != nil {
			return fmt.Errorf("update order: %w", err)
		}

		// Load package template
		var pkg tables.TablePlatformPackage
		if order.PackageID == nil {
			return fmt.Errorf("order has no package_id")
		}
		if err := tx.First(&pkg, "id = ?", *order.PackageID).Error; err != nil {
			return fmt.Errorf("find package: %w", err)
		}

		var createdEP *tables.TableEntityPackage
		var err error
		createdEP, err = s.provisionPackage(tx, &order, &pkg, order.UserID, nil, order.TenantType, order.TenantID)
		if err != nil {
			return err
		}
		ep = createdEP
		return nil
	})
	return ep, err
}

// provisionPackage creates all sub-resources for a purchased package within the given transaction:
// 1. billing Budget (MaxLimit = Quota / 100 USD, ExpiresAt = now + Duration days)
// 2. RateLimit (if package has RateLimitConfig)
// 3. UserProviderConfig per provider (UNION merge AllowedModels)
// 4. EntityPackage (linking all sub-resources)
// 5. Save OffPeakDiscount to EntityPackage and Budget
func (s *BillingService) provisionPackage(
	tx *gorm.DB,
	order *tables.TablePlatformOrder,
	pkg *tables.TablePlatformPackage,
	userID *string,
	orderNoOverride *string,
	tenantType tables.TenantType,
	tenantID string,
) (*tables.TableEntityPackage, error) {
	now := time.Now()
	expiresAt := now.Add(time.Duration(pkg.Duration) * 24 * time.Hour)
	maxLimitUSD := pkg.Quota / 100.0

	// 1. Create billing Budget
	budget := tables.TableBudget{
		ID:              schemas.NewID(),
		Type:            tables.BudgetTypeBilling,
		MaxLimit:        maxLimitUSD,
		ResetDuration:   "0",
		CurrentUsage:    0,
		ExpiresAt:       &expiresAt,
		OffPeakDiscount: pkg.OffPeakDiscount,
	}
	switch tenantType {
	case tables.TenantTypePersonal:
		budget.UserID = &tenantID
	case tables.TenantTypeOrganization:
		budget.CustomerID = &tenantID
	default:
		return nil, fmt.Errorf("invalid tenantType: %s", tenantType)
	}
	if err := tx.Create(&budget).Error; err != nil {
		return nil, fmt.Errorf("create budget: %w", err)
	}
	// Sync to governance store in-memory map so DeductBillingBudgets can find it immediately.
	if s.budgetStore != nil {
		s.budgetStore.StoreBudget(context.TODO(), &budget)
	}

	// 2. Create RateLimit if package has one
	var rateLimitID *string
	if pkg.RateLimitConfig != "" {
		rl, err := createRateLimitFromJSON(tx, pkg.RateLimitConfig)
		if err != nil {
			return nil, fmt.Errorf("create rate limit: %w", err)
		}
		rateLimitID = &rl.ID
	}

	// 3. Upsert UserProviderConfig per provider (if AllowedModels is specified)
	var userProviderConfigID *string
	if pkg.AllowedModels != "" && userID != nil && *userID != "" {
		upcID, err := s.upsertUserProviderConfigs(tx, *userID, pkg.AllowedModels)
		if err != nil {
			return nil, fmt.Errorf("upsert user provider config: %w", err)
		}
		userProviderConfigID = upcID
	}

	// 4. Create EntityPackage
	epID := schemas.NewID()
	orderNo := order.OrderNo
	if orderNoOverride != nil {
		orderNo = *orderNoOverride
	}
	ep := tables.TableEntityPackage{
		ID:                   epID,
		UserID:               userID,
		PackageID:            pkg.ID,
		BudgetID:             &budget.ID,
		RateLimitID:          rateLimitID,
		UserProviderConfigID: userProviderConfigID,
		OffPeakDiscount:      pkg.OffPeakDiscount,
		AutoRenew:            pkg.AutoRenew,
		StartedAt:            now,
		ExpiresAt:            expiresAt,
		Source:               tables.EntityPackageSourceOrder,
		OrderID:              &orderNo,
		Status:               tables.EntityPackageStatusActive,
		TenantType:           tenantType,
		TenantID:             tenantID,
	}
	if order.PaymentMethod == "admin" {
		ep.Source = tables.EntityPackageSourceAdmin
	}
	if err := tx.Create(&ep).Error; err != nil {
		return nil, fmt.Errorf("create entity package: %w", err)
	}

	// 5. Update order with EntityPackageID
	order.EntityPackageID = &epID
	if err := tx.Save(order).Error; err != nil {
		return nil, fmt.Errorf("update order with entity_package_id: %w", err)
	}

	return &ep, nil
}

// createRateLimitFromJSON parses a RateLimitConfig JSON string and creates a RateLimit record.
// Expected format: {"token_max_limit": N, "token_reset_duration": "1d", "request_max_limit": M, "request_reset_duration": "1h"}
func createRateLimitFromJSON(tx *gorm.DB, configJSON string) (*tables.TableRateLimit, error) {
	var cfg struct {
		TokenMaxLimit        *int64  `json:"token_max_limit"`
		TokenResetDuration   *string `json:"token_reset_duration"`
		RequestMaxLimit      *int64  `json:"request_max_limit"`
		RequestResetDuration *string `json:"request_reset_duration"`
	}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("invalid rate_limit_config JSON: %w", err)
	}

	rl := tables.TableRateLimit{
		ID:                   schemas.NewID(),
		TokenMaxLimit:        cfg.TokenMaxLimit,
		TokenResetDuration:   cfg.TokenResetDuration,
		RequestMaxLimit:      cfg.RequestMaxLimit,
		RequestResetDuration: cfg.RequestResetDuration,
	}
	if err := tx.Create(&rl).Error; err != nil {
		return nil, fmt.Errorf("persist rate limit: %w", err)
	}
	return &rl, nil
}

// allowedModelsMap represents the AllowedModels JSON structure:
// map of provider name -> list of allowed model patterns.
// Example: {"openai": ["gpt-4o", "gpt-4o-mini"], "anthropic": ["claude-3.5-sonnet"]}
type allowedModelsMap map[string][]string

// upsertUserProviderConfigs creates or updates UserProviderConfig rows for the user.
// The AllowedModels JSON is expected as: {"openai": ["gpt-4o"], "anthropic": ["claude-3.5-sonnet"]}
// For each provider, it upserts the row with UNION merge of existing and new models.
// Returns the ID of the first upserted config (for EntityPackage linking).
func (s *BillingService) upsertUserProviderConfigs(tx *gorm.DB, userID string, allowedModelsJSON string) (*string, error) {
	var modelsMap allowedModelsMap
	if err := json.Unmarshal([]byte(allowedModelsJSON), &modelsMap); err != nil {
		return nil, fmt.Errorf("invalid allowed_models JSON: %w", err)
	}

	if len(modelsMap) == 0 {
		return nil, nil
	}

	var firstID *string
	for provider, models := range modelsMap {
		if provider == "" || len(models) == 0 {
			continue
		}

		var upc tables.TableUserProviderConfig
		err := tx.Where("user_id = ? AND provider = ?", userID, provider).First(&upc).Error

		if err == gorm.ErrRecordNotFound {
			// Create new
			upc = tables.TableUserProviderConfig{
				UserID:        userID,
				Provider:      provider,
				AllowedModels: schemas.WhiteList(models),
			}
			if err := tx.Create(&upc).Error; err != nil {
				return nil, fmt.Errorf("create user_provider_config for %s: %w", provider, err)
			}
		} else if err != nil {
			return nil, fmt.Errorf("query user_provider_config for %s: %w", provider, err)
		} else {
			// Exists — UNION merge AllowedModels
			merged := unionWhiteLists(upc.AllowedModels, models)
			upc.AllowedModels = merged
			if err := tx.Save(&upc).Error; err != nil {
				return nil, fmt.Errorf("update user_provider_config for %s: %w", provider, err)
			}
		}

		if firstID == nil {
			idStr := fmt.Sprintf("%d", upc.ID)
			firstID = &idStr
		}
	}
	return firstID, nil
}

// unionWhiteLists merges two model lists, deduplicating while preserving
// wildcard semantics: if either list is ["*"], result is ["*"].
func unionWhiteLists(existing schemas.WhiteList, incoming []string) schemas.WhiteList {
	// Check for wildcard
	for _, m := range existing {
		if m == "*" {
			return schemas.WhiteList{"*"}
		}
	}
	for _, m := range incoming {
		if m == "*" {
			return schemas.WhiteList{"*"}
		}
	}

	seen := make(map[string]bool)
	result := make(schemas.WhiteList, 0)
	for _, m := range existing {
		if !seen[m] {
			seen[m] = true
			result = append(result, m)
		}
	}
	for _, m := range incoming {
		if !seen[m] {
			seen[m] = true
			result = append(result, m)
		}
	}
	return result
}

// ---------------------------------------------------------------------------
// EntityPackage queries (Epic II-B-3)
// ---------------------------------------------------------------------------

// GetEntityPackage returns a single entity package by ID.
func (s *BillingService) GetEntityPackage(ctx context.Context, epID string) (*tables.TableEntityPackage, error) {
	var ep tables.TableEntityPackage
	if err := s.db.WithContext(ctx).Preload("Package").First(&ep, "id = ?", epID).Error; err != nil {
		return nil, err
	}
	return &ep, nil
}

// ListEntityPackages returns paginated entity packages for a user or customer.
func (s *BillingService) ListEntityPackages(
	ctx context.Context,
	userID *string,
	tenantType *tables.TenantType,
	tenantID *string,
	status *tables.EntityPackageStatus,
	offset, limit int,
) ([]tables.TableEntityPackage, int64, error) {
	q := s.db.WithContext(ctx).Model(&tables.TableEntityPackage{}).Preload("Package")
	if userID != nil {
		q = q.Where("user_id = ?", *userID)
	}
	if tenantType != nil && tenantID != nil && *tenantID != "" {
		// Both type and ID: most specific filter
		q = q.Where("tenant_type = ? AND tenant_id = ?", *tenantType, *tenantID)
	} else if tenantType != nil {
		// Type only
		q = q.Where("tenant_type = ?", *tenantType)
	} else if tenantID != nil && *tenantID != "" {
		// ID only (any type)
		q = q.Where("tenant_id = ?", *tenantID)
	}
	if status != nil {
		q = q.Where("status = ?", *status)
	}

	var total int64
	q.Count(&total)

	var eps []tables.TableEntityPackage
	err := q.Order("created_at DESC").Offset(offset).Limit(limit).Find(&eps).Error
	return eps, total, err
}

// ---------------------------------------------------------------------------
// Package Expiry / Downgrade (Epic II-B-5)
// ---------------------------------------------------------------------------

// HandlePackageExpiry marks expired entity packages and rebuilds UserProviderConfig.
// This can be called by a cron job or lazily on request.
func (s *BillingService) HandlePackageExpiry(ctx context.Context) error {
	now := time.Now()

	// Find all active entity packages that have expired
	var expiredEPs []tables.TableEntityPackage
	if err := s.db.WithContext(ctx).
		Where("status = ? AND expires_at <= ?", tables.EntityPackageStatusActive, now).
		Find(&expiredEPs).Error; err != nil {
		return fmt.Errorf("find expired packages: %w", err)
	}

	if len(expiredEPs) == 0 {
		return nil
	}

	// Collect unique user IDs that need UserProviderConfig rebuild
	usersNeedingRebuild := make(map[string]bool)

	for _, ep := range expiredEPs {
		// Mark as expired
		if err := s.db.WithContext(ctx).Model(&ep).Update("status", tables.EntityPackageStatusExpired).Error; err != nil {
			return fmt.Errorf("mark entity_package %s as expired: %w", ep.ID, err)
		}
		if ep.UserID != nil {
			usersNeedingRebuild[*ep.UserID] = true
		}
	}

	// Rebuild UserProviderConfig for affected users
	for userID := range usersNeedingRebuild {
		if err := s.rebuildUserProviderConfigs(ctx, userID); err != nil {
			return fmt.Errorf("rebuild user_provider_configs for user %s: %w", userID, err)
		}
	}

	return nil
}

// CheckAndExpireUserPackages lazily checks and expires packages for a specific user.
// Called during request-time access checks.
func (s *BillingService) CheckAndExpireUserPackages(ctx context.Context, userID string) error {
	now := time.Now()

	var expiredEPs []tables.TableEntityPackage
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND status = ? AND expires_at <= ?", userID, tables.EntityPackageStatusActive, now).
		Find(&expiredEPs).Error; err != nil {
		return fmt.Errorf("find expired packages for user %s: %w", userID, err)
	}

	if len(expiredEPs) == 0 {
		return nil
	}

	for _, ep := range expiredEPs {
		if err := s.db.WithContext(ctx).Model(&ep).Update("status", tables.EntityPackageStatusExpired).Error; err != nil {
			return fmt.Errorf("mark entity_package %s as expired: %w", ep.ID, err)
		}
	}

	return s.rebuildUserProviderConfigs(ctx, userID)
}

// rebuildUserProviderConfigs reconstructs the AllowedModels for each provider row
// by querying all active EntityPackages for the user and UNION-merging their models.
// If no active packages remain for a provider, that provider row is deleted.
func (s *BillingService) rebuildUserProviderConfigs(ctx context.Context, userID string) error {
	// Find all active entity packages for this user
	var activeEPs []tables.TableEntityPackage
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, tables.EntityPackageStatusActive).
		Preload("Package").
		Find(&activeEPs).Error; err != nil {
		return fmt.Errorf("find active entity packages: %w", err)
	}

	// Collect AllowedModels per provider from active packages
	providerModels := make(map[string][]string) // provider -> merged models
	for _, ep := range activeEPs {
		if ep.Package.AllowedModels == "" {
			continue
		}
		var modelsMap allowedModelsMap
		if err := json.Unmarshal([]byte(ep.Package.AllowedModels), &modelsMap); err != nil {
			continue // skip malformed
		}
		for provider, models := range modelsMap {
			existing, ok := providerModels[provider]
			if !ok {
				providerModels[provider] = models
			} else {
				providerModels[provider] = append(existing, models...)
			}
		}
	}

	// Get all existing UserProviderConfig rows for this user
	var existingUPCs []tables.TableUserProviderConfig
	s.db.WithContext(ctx).Where("user_id = ?", userID).Find(&existingUPCs)

	// Process each existing provider row
	for _, upc := range existingUPCs {
		merged, hasActive := providerModels[upc.Provider]
		if !hasActive || len(merged) == 0 {
			// No active packages for this provider — delete the row
			if err := s.db.WithContext(ctx).Delete(&upc).Error; err != nil {
				return fmt.Errorf("delete user_provider_config for %s: %w", upc.Provider, err)
			}
			continue
		}
		// Update with merged models
		deduped := dedupeStrings(merged)
		upc.AllowedModels = schemas.WhiteList(deduped)
		// Clear EntityPackageID since this is now derived from multiple packages
		upc.EntityPackageID = nil
		if err := s.db.WithContext(ctx).Save(&upc).Error; err != nil {
			return fmt.Errorf("update user_provider_config for %s: %w", upc.Provider, err)
		}
		delete(providerModels, upc.Provider) // mark as processed
	}

	// Create new rows for providers not yet in the DB
	for provider, models := range providerModels {
		deduped := dedupeStrings(models)
		newUPC := tables.TableUserProviderConfig{
			UserID:        userID,
			Provider:      provider,
			AllowedModels: schemas.WhiteList(deduped),
		}
		if err := s.db.WithContext(ctx).Create(&newUPC).Error; err != nil {
			// Handle race: another concurrent purchase may have created it
			var existing tables.TableUserProviderConfig
			if findErr := s.db.WithContext(ctx).Where("user_id = ? AND provider = ?", userID, provider).First(&existing).Error; findErr == nil {
				merged := unionWhiteLists(existing.AllowedModels, deduped)
				existing.AllowedModels = merged
				s.db.WithContext(ctx).Save(&existing)
			} else {
				return fmt.Errorf("create user_provider_config for %s: %w", provider, err)
			}
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Order queries (Epic I-C-4)
// ---------------------------------------------------------------------------

// GetOrder returns a single order by ID.
func (s *BillingService) GetOrder(ctx context.Context, orderID uint) (*tables.TablePlatformOrder, error) {
	var order tables.TablePlatformOrder
	if err := s.db.WithContext(ctx).First(&order, orderID).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

// ListOrders returns paginated orders filtered by owner and optional type/status.
func (s *BillingService) ListOrders(
	ctx context.Context,
	userID *string,
	customerID *string,
	orderType *tables.OrderType,
	status *tables.OrderStatus,
	offset, limit int,
) ([]tables.TablePlatformOrder, int64, error) {
	q := s.db.WithContext(ctx).Model(&tables.TablePlatformOrder{})
	if userID != nil {
		q = q.Where("user_id = ?", *userID)
	}
	if customerID != nil {
		q = q.Where("customer_id = ?", *customerID)
	}
	if orderType != nil {
		q = q.Where("type = ?", *orderType)
	}
	if status != nil {
		q = q.Where("status = ?", *status)
	}

	var total int64
	q.Count(&total)

	var orders []tables.TablePlatformOrder
	err := q.Order("created_at DESC").Offset(offset).Limit(limit).Find(&orders).Error
	return orders, total, err
}

// ---------------------------------------------------------------------------
// Webhook Processing (Epic III-B-1)
// ---------------------------------------------------------------------------

// HandleWebhookResult processes a WebhookResult by matching the order number
// and executing the appropriate business logic (recharge or purchase).
// This is called after the gateway verifies the webhook signature.
func (s *BillingService) HandleWebhookResult(ctx context.Context, result *WebhookResult) error {
	if result == nil {
		return nil
	}

	// Find the order by order_no
	var order tables.TablePlatformOrder
	if err := s.db.WithContext(ctx).Where("order_no = ?", result.OrderNo).First(&order).Error; err != nil {
		return fmt.Errorf("find order by order_no %s: %w", result.OrderNo, err)
	}

	// Idempotent: only process pending orders
	if order.Status != tables.OrderStatusPending {
		return nil
	}

	switch result.Status {
	case "success":
		now := time.Now()
		order.Status = tables.OrderStatusSuccess
		order.PaymentID = result.PaymentID
		order.PaymentMethod = result.PaymentMethod
		order.PaidAt = &now

		if err := s.db.WithContext(ctx).Save(&order).Error; err != nil {
			return fmt.Errorf("update order %s to success: %w", order.OrderNo, err)
		}

		// Execute business logic based on order type
		switch order.Type {
		case tables.OrderTypeRecharge:
			dollars := order.Credits / 100.0
			_, err := s.findOrCreateBalanceBudget(s.db, order.UserID, order.TenantType, order.TenantID, dollars)
			if err != nil {
				return fmt.Errorf("recharge budget for order %s: %w", order.OrderNo, err)
			}

		case tables.OrderTypePackagePurchase:
			if order.PackageID == nil {
				return fmt.Errorf("order %s: missing package_id for purchase order", order.OrderNo)
			}
			var pkg tables.TablePlatformPackage
			if err := s.db.WithContext(ctx).First(&pkg, "id = ?", *order.PackageID).Error; err != nil {
				return fmt.Errorf("find package for order %s: %w", order.OrderNo, err)
			}
			if _, err := s.provisionPackage(s.db, &order, &pkg, order.UserID, nil, order.TenantType, order.TenantID); err != nil {
				return fmt.Errorf("provision package for order %s: %w", order.OrderNo, err)
			}
		}

	case "expired":
		order.Status = tables.OrderStatusExpired
		if err := s.db.WithContext(ctx).Save(&order).Error; err != nil {
			return fmt.Errorf("update order %s to expired: %w", order.OrderNo, err)
		}
	}

	return nil
}

// HandleOrderExpiry checks for pending orders that have exceeded their TTL
// and marks them as expired. Can be called by a cron job or lazily.
func (s *BillingService) HandleOrderExpiry(ctx context.Context, ttl time.Duration) error {
	cutoff := time.Now().Add(-ttl)

	var expiredOrders []tables.TablePlatformOrder
	if err := s.db.WithContext(ctx).
		Where("status = ? AND created_at <= ?", tables.OrderStatusPending, cutoff).
		Find(&expiredOrders).Error; err != nil {
		return fmt.Errorf("find expired orders: %w", err)
	}

	if len(expiredOrders) == 0 {
		return nil
	}

	for _, order := range expiredOrders {
		if err := s.db.WithContext(ctx).Model(&order).Update("status", tables.OrderStatusExpired).Error; err != nil {
			return fmt.Errorf("mark order %s as expired: %w", order.OrderNo, err)
		}
	}

	return nil
}

// CancelOrder marks a pending order as cancelled.
func (s *BillingService) CancelOrder(ctx context.Context, orderID uint) error {
	result := s.db.WithContext(ctx).
		Model(&tables.TablePlatformOrder{}).
		Where("id = ? AND status = ?", orderID, tables.OrderStatusPending).
		Update("status", tables.OrderStatusCanceled)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("order not found or not pending")
	}
	return nil
}

// ConfirmOrder marks a pending order as success and executes the corresponding fulfillment action:
// - recharge order → credits the balance budget (same as HandleRechargeSuccess)
// - purchase order → provisions the package and creates an entity-package (same as HandlePurchaseSuccess)
// Idempotent: if the order is already success, returns nil without error.
func (s *BillingService) ConfirmOrder(ctx context.Context, orderID uint) (*tables.TableEntityPackage, error) {
	// Load the order first to determine its type
	var order tables.TablePlatformOrder
	if err := s.db.WithContext(ctx).First(&order, orderID).Error; err != nil {
		return nil, fmt.Errorf("find order: %w", err)
	}

	switch order.Type {
	case tables.OrderTypeRecharge:
		// HandleRechargeSuccess is already idempotent
		if err := s.HandleRechargeSuccess(ctx, orderID, "manual"); err != nil {
			return nil, fmt.Errorf("confirm recharge: %w", err)
		}
		return nil, nil

	case tables.OrderTypePackagePurchase:
		// HandlePurchaseSuccess is already idempotent
		ep, err := s.HandlePurchaseSuccess(ctx, orderID, "manual")
		if err != nil {
			return nil, fmt.Errorf("confirm purchase: %w", err)
		}
		return ep, nil

	default:
		return nil, fmt.Errorf("order type %s cannot be confirmed", order.Type)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// dedupeStrings removes duplicates from a string slice.
func dedupeStrings(ss []string) []string {
	slices.Sort(ss)
	return slices.Compact(ss)
}

// defaultPaymentMethod returns the default payment method for a gateway.
func defaultPaymentMethod(gatewayID string) string {
	switch gatewayID {
	case "stripe":
		return "card"
	case "alipay":
		return "alipay"
	case "wechat_pay":
		return "wechat_pay"
	case "manual":
		return "admin"
	default:
		return "unknown"
	}
}

// parseExpiresAt converts a Unix timestamp string to a *time.Time.
// Returns nil if the string is empty or invalid.
func parseExpiresAt(expiresAtStr string) *time.Time {
	if expiresAtStr == "" {
		return nil
	}
	ts, err := strconv.ParseInt(expiresAtStr, 10, 64)
	if err != nil {
		return nil
	}
	t := time.Unix(ts, 0)
	return &t
}

// RetryOrder re-attempts payment for a pending order.
// Returns the updated checkout URL (existing if still valid, new if expired).
func (s *BillingService) RetryOrder(ctx context.Context, orderID uint) (*tables.TablePlatformOrder, *PaymentResult, error) {
	var order tables.TablePlatformOrder
	if err := s.db.WithContext(ctx).First(&order, orderID).Error; err != nil {
		return nil, nil, fmt.Errorf("find order: %w", err)
	}

	if order.Status != tables.OrderStatusPending {
		return nil, nil, fmt.Errorf("only pending orders can be retried")
	}

	// Get the gateway associated with this order
	gw, err := s.registry.Get(order.Gateway)
	if err != nil {
		return nil, nil, fmt.Errorf("get payment gateway %q: %w", order.Gateway, err)
	}

	result, err := gw.RetryPayment(ctx, &order)
	if err != nil {
		return nil, nil, fmt.Errorf("gateway retry: %w", err)
	}

	// Update order with new payment details
	updates := map[string]interface{}{
		"payment_id":          result.PaymentID,
		"checkout_url":        result.CheckoutURL,
		"checkout_expires_at": parseExpiresAt(result.ExpiresAt),
	}
	if err := s.db.WithContext(ctx).Model(&order).Updates(updates).Error; err != nil {
		return nil, nil, fmt.Errorf("update order: %w", err)
	}

	// Reload order
	s.db.WithContext(ctx).First(&order, orderID)
	return &order, result, nil
}
