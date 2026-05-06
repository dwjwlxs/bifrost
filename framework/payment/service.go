package payment

import (
	"context"
	"fmt"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// BillingService handles order and recharge business logic.
type BillingService struct {
	db      *gorm.DB
	gateway PaymentGateway
}

// NewBillingService creates a new BillingService.
func NewBillingService(db *gorm.DB, gateway PaymentGateway) *BillingService {
	return &BillingService{db: db, gateway: gateway}
}

// CreateRechargeOrder creates a pending recharge order and initiates payment via the gateway.
func (s *BillingService) CreateRechargeOrder(
	ctx context.Context,
	userID *string,
	customerID *string,
	amount float64,
	credits float64,
	opts PaymentOptions,
) (*tables.TablePlatformOrder, *PaymentResult, error) {
	order := &tables.TablePlatformOrder{
		OrderNo:    fmt.Sprintf("RCH-%s", schemas.NewID()),
		UserID:     userID,
		CustomerID: customerID,
		Type:       tables.OrderTypeRecharge,
		Amount:     amount,
		Credits:    credits,
		Status:     tables.OrderStatusPending,
	}

	if err := s.db.WithContext(ctx).Create(order).Error; err != nil {
		return nil, nil, fmt.Errorf("create recharge order: %w", err)
	}

	result, err := s.gateway.CreatePayment(ctx, order, opts)
	if err != nil {
		return order, nil, fmt.Errorf("gateway CreatePayment: %w", err)
	}
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
) (*tables.TablePlatformOrder, error) {
	dollars := credits / 100.0
	now := time.Now()

	var order tables.TablePlatformOrder
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		order = tables.TablePlatformOrder{
			OrderNo:       fmt.Sprintf("RCH-%s", schemas.NewID()),
			UserID:        userID,
			CustomerID:    customerID,
			Type:          tables.OrderTypeRecharge,
			Amount:        amount,
			Credits:       credits,
			Status:        tables.OrderStatusSuccess,
			PaymentMethod: "admin",
			PaidAt:        &now,
		}
		if err := tx.Create(&order).Error; err != nil {
			return fmt.Errorf("create admin order: %w", err)
		}
		_, err := s.findOrCreateBalanceBudget(tx, userID, customerID, dollars)
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
	paidAmount float64,
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
		_, err := s.findOrCreateBalanceBudget(tx, order.UserID, order.CustomerID, dollars)
		return err
	})
}

// findOrCreateBalanceBudget finds an existing balance-type billing budget
// (type=billing, reset_duration="0", expires_at IS NULL) or creates a new one,
// then adds dollars to MaxLimit.
func (s *BillingService) findOrCreateBalanceBudget(tx *gorm.DB, userID *string, customerID *string, dollars float64) (*tables.TableBudget, error) {
	var ownerField, ownerID string
	switch {
	case userID != nil && *userID != "":
		ownerField, ownerID = "user_id", *userID
	case customerID != nil && *customerID != "":
		ownerField, ownerID = "customer_id", *customerID
	default:
		return nil, fmt.Errorf("either user_id or customer_id must be specified")
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
		newBudget.UserID = userID
	} else {
		newBudget.CustomerID = customerID
	}
	return &newBudget, tx.Create(&newBudget).Error
}

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
