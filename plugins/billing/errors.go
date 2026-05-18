package billing

import (
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

// bifrost errors
var (
	BifrostErrVKRequired = &schemas.BifrostError{
		Type:           bifrost.Ptr("bifrost_vk_required"),
		StatusCode:     bifrost.Ptr(401),
		IsBifrostError: true,
		Error: &schemas.ErrorField{
			Message: ("bifrost vk required"),
		},
	}
	BifrostErrVKInvalid = &schemas.BifrostError{
		Type:           bifrost.Ptr("bifrost_vk_invalid"),
		StatusCode:     bifrost.Ptr(403),
		IsBifrostError: true,
		Error: &schemas.ErrorField{
			Message: ("bifrost vk invalid"),
		},
	}
	BifrostErrBillingBudgetExceeded = &schemas.BifrostError{
		Type:           bifrost.Ptr("billing_budget_exceeded"),
		StatusCode:     bifrost.Ptr(403),
		IsBifrostError: true,
		Error: &schemas.ErrorField{
			Message: ("billing budget exceeded"),
		},
	}
)
