package handlers

import "time"

func CalculateBucketSize(start, end *time.Time) int64 {
	return calculateBucketSize(start, end)
}
