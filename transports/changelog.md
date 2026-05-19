## ✨ Features

- **Dual-Track Billing** — New billing system with hybrid billing logic supporting dual-track budgets
- **Multi-Budget Support** — Migrated to multi-budget support for customers
- **User Provider Config** — Added user provider config support and enhanced governance context handling
- **Alipay Integration** — Added Alipay payment gateway integration and multi-gateway support
- **Personal Usage Analytics** — Added dimension rankings and personal usage analytics endpoints
- **Admin Provider Management** — Added full platform admin providers management UI and API support
- **Platform Multi-Tenant API** — Implemented platform multi-tenant architecture with API support

## 🐞 Fixed

- **Budget Store Sync** — Sync budget store and wrap order update in transaction
- **VK Hierarchy Caching** — Correct VK hierarchy caching and improve route registration
- **Billing MVP** — Bypass error to ensure billing MVP functionality
- **Empty Billing Budgets** — Handle empty billing budgets case
- **Billing Data Sharing** — Use Redis to share billing data across multi-nodes
- **Logstore Success Count** — Accumulate success count instead of overwriting
- **dRouter Fix** — Fixed dRouter issue
- **Email Template** — Remove unnecessary word from email template

## 🔧 Maintenance

- **Dependency Upgrades** — Upgraded core to v1.5.4 and framework to v1.3.4 across all modules