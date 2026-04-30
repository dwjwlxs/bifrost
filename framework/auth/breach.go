package auth

import (
	"crypto/sha1"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// hibpHTTPClient is the HTTP client for HaveIBeenPwned API calls.
// It uses a short timeout to avoid blocking the auth flow if the API is slow.
var hibpHTTPClient = &http.Client{
	Timeout: 3 * time.Second,
}

// CheckHaveIBeenPwned checks if a password has been exposed in known data breaches
// using the HaveIBeenPwned k-anonymity model.
//
// How it works:
//  1. Compute SHA-1 of the password
//  2. Send only the first 5 hex chars to the API
//  3. API returns all hash suffixes that match that prefix
//  4. Check if our full hash suffix appears in the results
//
// This way, the full password hash never leaves the client.
// If the API is unreachable, returns false (fail-open).
func CheckHaveIBeenPwned(password string) bool {
	hash := sha1.Sum([]byte(password))
	hashStr := fmt.Sprintf("%X", hash) // uppercase hex, e.g. "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8"

	prefix := hashStr[:5]
	suffix := hashStr[5:]

	url := fmt.Sprintf("https://api.pwnedpasswords.com/range/%s", prefix)

	resp, err := hibpHTTPClient.Get(url)
	if err != nil {
		// Fail open — don't block registration if HIBP is down
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	// Read the response body and check for the suffix
	// Response format: each line is "HASH_SUFFIX:COUNT"
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}
	bodyStr := string(body)

	for _, line := range strings.Split(bodyStr, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 && strings.ToUpper(parts[0]) == suffix {
			return true // Found — password is breached
		}
	}

	return false
}
