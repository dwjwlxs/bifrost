package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// OWASP-recommended Argon2id parameters.
const (
	argon2Memory      = 19456 // 19 MB
	argon2Iterations  = 2
	argon2Parallelism = 1
	argon2SaltLength  = 16
	argon2KeyLength   = 32
)

// PasswordHasher abstracts password hashing and verification.
// The default implementation uses Argon2id with OWASP-recommended parameters.
type PasswordHasher interface {
	// Hash produces an encoded Argon2id hash of the password.
	Hash(password string) (string, error)

	// Verify checks a password against an encoded Argon2id hash.
	Verify(password, encodedHash string) (bool, error)
}

// argon2idHasher implements PasswordHasher using Argon2id.
type argon2idHasher struct{}

// NewPasswordHasher returns a new Argon2id password hasher.
func NewPasswordHasher() PasswordHasher {
	return &argon2idHasher{}
}

// Hash produces an Argon2id encoded hash.
// Output format: $argon2id$v=19$m=19456,t=2,p=1$<salt_b64>$<hash_b64>
func (h *argon2idHasher) Hash(password string) (string, error) {
	salt := make([]byte, argon2SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("%w: %v", ErrPasswordHashFailed, err)
	}

	hash := argon2.IDKey(
		[]byte(password),
		salt,
		uint32(argon2Iterations),
		uint32(argon2Memory),
		uint8(argon2Parallelism),
		uint32(argon2KeyLength),
	)

	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argon2Memory,
		argon2Iterations,
		argon2Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)

	return encoded, nil
}

// Verify checks the password against the encoded Argon2id hash.
func (h *argon2idHasher) Verify(password, encodedHash string) (bool, error) {
	p, salt, expectedHash, err := decodeArgon2Hash(encodedHash)
	if err != nil {
		return false, err
	}

	hash := argon2.IDKey(
		[]byte(password),
		salt,
		p.iterations,
		p.memory,
		p.parallelism,
		p.keyLength,
	)

	// Constant-time comparison to prevent timing attacks.
	if subtle.ConstantTimeCompare(hash, expectedHash) == 1 {
		return true, nil
	}
	return false, nil
}

// argon2Params holds parsed Argon2id parameters.
type argon2Params struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
	keyLength   uint32
}

// decodeArgon2Hash parses an Argon2id encoded hash string.
func decodeArgon2Hash(encoded string) (p argon2Params, salt []byte, hash []byte, err error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 {
		err = fmt.Errorf("%w: invalid hash format", ErrPasswordVerifyFailed)
		return
	}

	// parts[0] = "" (before first $), parts[1] = "argon2id", parts[2] = "v=19", etc.
	if parts[1] != "argon2id" {
		err = fmt.Errorf("%w: unsupported algorithm %s", ErrPasswordVerifyFailed, parts[1])
		return
	}

	// Parse version
	verStr := strings.TrimPrefix(parts[2], "v=")
	ver, e := strconv.Atoi(verStr)
	if e != nil || ver != argon2.Version {
		err = fmt.Errorf("%w: unsupported version %s", ErrPasswordVerifyFailed, parts[2])
		return
	}

	// Parse m, t, p from "m=19456,t=2,p=1"
	params := strings.Split(parts[3], ",")
	if len(params) != 3 {
		err = fmt.Errorf("%w: invalid parameters", ErrPasswordVerifyFailed)
		return
	}

	mem, e := strconv.ParseUint(strings.TrimPrefix(params[0], "m="), 10, 32)
	if e != nil {
		err = fmt.Errorf("%w: invalid memory parameter", ErrPasswordVerifyFailed)
		return
	}
	p.memory = uint32(mem)

	iter, e := strconv.ParseUint(strings.TrimPrefix(params[1], "t="), 10, 32)
	if e != nil {
		err = fmt.Errorf("%w: invalid iterations parameter", ErrPasswordVerifyFailed)
		return
	}
	p.iterations = uint32(iter)

	par, e := strconv.ParseUint(strings.TrimPrefix(params[2], "p="), 10, 8)
	if e != nil {
		err = fmt.Errorf("%w: invalid parallelism parameter", ErrPasswordVerifyFailed)
		return
	}
	p.parallelism = uint8(par)

	// Decode salt
	salt, err = base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		err = fmt.Errorf("%w: invalid salt encoding", ErrPasswordVerifyFailed)
		return
	}

	// Decode hash
	hash, err = base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		err = fmt.Errorf("%w: invalid hash encoding", ErrPasswordVerifyFailed)
		return
	}

	p.keyLength = uint32(len(hash))
	return
}

// HashSHA256Base64 returns Base64(SHA-256(data)).
// Used for hashing verification codes before storage (never stored in plaintext).
func HashSHA256Base64(data string) string {
	h := sha256.Sum256([]byte(data))
	return base64.RawStdEncoding.EncodeToString(h[:])
}

// HashSHA256Hex returns Hex(SHA-256(data)).
func HashSHA256Hex(data string) string {
	h := sha256.Sum256([]byte(data))
	return fmt.Sprintf("%x", h)
}
