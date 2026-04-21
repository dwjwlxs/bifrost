package configstore

import (
	"encoding/json"
	"fmt"

	"gorm.io/gorm"
)

// marshalToString marshals the given value to a JSON string.
func marshalToString(v any) (string, error) {
	if v == nil {
		return "", nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// marshalToStringPtr marshals the given value to a JSON string and returns a pointer to the string.
func marshalToStringPtr(v any) (*string, error) {
	if v == nil {
		return nil, nil
	}
	data, err := marshalToString(v)
	if err != nil {
		return nil, err
	}
	return &data, nil
}

// deepCopy creates a deep copy of a given type
func deepCopy[T any](in T) (T, error) {
	var out T
	b, err := json.Marshal(in)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(b, &out)
	return out, err
}

// dropIndexIfExists executes a dialect-aware DROP INDEX statement.
// MySQL requires DROP INDEX <name> ON <table>; PostgreSQL and SQLite support DROP INDEX IF EXISTS <name>.
func dropIndexIfExists(tx *gorm.DB, indexName, tableName string) error {
	var sql string
	if tx.Dialector.Name() == "mysql" {
		sql = fmt.Sprintf("DROP INDEX %s ON %s", indexName, tableName)
	} else {
		sql = fmt.Sprintf("DROP INDEX IF EXISTS %s", indexName)
	}
	return tx.Exec(sql).Error
}

// dropIndex executes a dialect-aware DROP INDEX statement without an existence check.
// Use this when HasIndex has already been called to confirm the index exists.
// MySQL requires DROP INDEX <name> ON <table>; PostgreSQL and SQLite use DROP INDEX <name>.
func dropIndex(tx *gorm.DB, indexName, tableName string) error {
	var sql string
	if tx.Dialector.Name() == "mysql" {
		sql = fmt.Sprintf("DROP INDEX %s ON %s", indexName, tableName)
	} else {
		sql = fmt.Sprintf("DROP INDEX %s", indexName)
	}
	return tx.Exec(sql).Error
}
