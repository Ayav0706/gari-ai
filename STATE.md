# Gari State - Project Progress

## Current Objectives
- [x] Implement Photo/Document/Sticker handlers (bot.ts)
- [x] Context overflow protection (trimMessages in agent/loop.ts)
- [x] Tool timeout protection (30s timeout in registry.ts)
- [x] Retry with backoff in FailoverProvider (provider.ts)
- [x] System Prompt v2 — Chain-of-thought, anti-patterns, structured sections
- [x] Dynamic context injection — Date/time/timezone in every agent call
- [x] Update .env.example with all secret placeholders
- [ ] Auto-save user context from conversations (memory improvement)
- [ ] Conversation summarization for long histories
- [ ] Memory categories/tags system

## Upgrade v2 Completed (2025-03-06)
### Fase 1: Hardening
- Photo handler → captions procesados via agent, fotos sin caption → respuesta guía
- Document handler → mismo patrón, nombre de archivo mostrado
- Sticker handler → respuesta amigable
- Context overflow → trimMessages() con budget de 6000 tokens estimados
- Tool timeout → Promise.race con 30s limit
- Retry backoff → 2s para rate limits, 1s para errores de servicio

### Fase 3: System Prompt Elite
- Reescritura completa con secciones: Filosofía, Chain-of-Thought, Anti-Patterns, Reglas
- buildDynamicContext() → inyecta día/fecha/hora/timezone en español

## Next Steps
1. Ejecutar prueba E2E con Groq/Telegram validando flujo completo `user -> tool_calls -> tool -> assistant`
2. Validar persistencia en Firestore (`request_id`, `created_at_ms`, `name`) y ausencia de tool results huérfanos
3. Cerrar Fase 2 (Memory improvements) y marcar estado final
