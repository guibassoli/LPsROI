# Flow Log — Extrator Captura Aberto (frontend, repo LPsROI)

> Feature cross-repo. ADR + spec completas vivem em `nucleo_roi/.specs/decisions/0012-extrator-captura-aberta.md` + `nucleo_roi/.specs/features/extrator-captura-aberta/spec.md`. Este log cobre só a parte do frontend (Fases F1..F4).

## Sizing: médio
## Fluxo: padrão (sem TDD — ver exceção abaixo)

## Etapas

| # | Etapa | Status | Data | Notas |
|---|-------|--------|------|-------|
| 1 | Entender | concluído | 2026-05-12 | ADR 0012 + spec já aprovados em sessão anterior. Backend deployado em `https://nucleo-api.roicomia.com` |
| 2 | Especificar | concluído | 2026-05-12 | Spec completa no `nucleo_roi`, requisitos de frontend: EXT-10..EXT-15 + EXT-17 + EXT-18 |
| 3 | Trade-off | concluído | 2026-05-12 | 4 alternativas avaliadas no ADR. Decisão: captura imediata, banner pós-submit pro grupo, cutover URL+key big-bang |
| 4 | Isolar | concluído | 2026-05-12 | Worktree `feat/extrator-gate-aberto` criada de `origin/dev` (criada manualmente via `git worktree add` — `EnterWorktree` é vinculado à sessão do nucleo_roi) |
| 5 | Testes primeiro (TDD) | **PULADO** | 2026-05-12 | Ver exceção abaixo |
| 6 | Implementar | concluído | 2026-05-12 | F1+F2+F3 em 3 commits (UI gate, JS captureGateSubmit + banner, cutover URL+key) |
| 7 | Validar | concluído (parcial) | 2026-05-12 | Smoke contra prod (`nucleo-api.roicomia.com`) verde nos 3 endpoints. Visual em browser real fica com o user |
| 8 | PR | em andamento | 2026-05-12 | gh pr create base=dev |
| 9 | Gate | pendente | | sugerir `/rsh-gate` no PR |

## Exceções a testes-primeiro

- **F1..F4**: LP estática vanilla HTML/JS hospedada na Cloudflare Pages, **sem framework de teste no projeto** (`bun test`, `vitest`, `jest` — nada). Não há infraestrutura pra automatizar smoke do gate. Validação é manual em browser. Smoke automatizado feito no nível do **endpoint backend** (`nucleo_roi/apps/api/src/routes/public/tracking.test.ts` — 9 cases cobrindo o contrato HTTP, rodam contra Postgres no CI). Risco mitigado por: (a) backend já validado em prod via curl, (b) JS é simples (validação client-side + 1 fetch + 3 callbacks), (c) checklist manual definido em F4.

## Re-âncoras feitas

- 2026-05-12 antes de Implementar: re-leu spec EXT-10..EXT-18. Drift detectado: nenhum.
- 2026-05-12 durante F3: descobriu que `tracker.js` é compartilhado por **TODAS as 10 LPs** (não só extrator) e tem própria `API_KEY`. Spec original previa só trocar `API_URL`, mas key também precisa ser atualizada (key velha é do `nucleo-inteligencia`, retorna 401 contra `nucleo_roi`). Decisão: criar key dedicada pro tracker (`LPsROI tracker`) separada da do gate (`LPsROI extrator gate`) — permite revogação independente.

## Decisões tomadas durante a implementação

### 2026-05-12 — Key dedicada pro `tracker.js` (separada da do gate)

**Contexto:** `tracker.js` é compartilhado por todas as LPs do repo (extrator/survey/ficha/agendar/calendario/grupo/index/workbook/aplicacao-enviada/_wk-embed). Spec EXT-17 mencionava trocar só `API_URL`, mas a `API_KEY` velha é do `nucleo-inteligencia` (retorna 401 no `nucleo_roi`). Precisa de uma key válida no `nucleo_roi`.

**Decisão:** Provisionar 2 keys distintas em vez de 1:
- `LPsROI extrator gate` (`nuc_0621ef28...`) — usada SÓ pelo `extrator.html` no `captureGateSubmit`
- `LPsROI tracker` (`nuc_1d424740...`) — usada pelo `tracker.js` em TODAS as LPs

**Por quê:**
- Se uma key vazar/precisar rotacionar, mexe só num escopo (gate vs tracking genérico).
- Custo de criar 2 vs 1 é zero (script `key:create` é one-liner).
- Cada uma tem `name` semântico em `apiKeys` — fácil identificar/revogar via UI/SQL.

### 2026-05-12 — Não migrar `ficha.html` nesta PR

**Contexto:** `ficha.html` ainda tem `GATE_CHECK_URL = 'https://core-api.roisemhype.cloud/public/tracking/check-access'` (gate de allowlist próprio) E o submit final (form completo) já foi migrado pro `nucleo_roi` em PR anterior (#30). Mas o gate de entrada continua chamando o `nucleo-inteligencia`.

**Decisão:** Deixar `ficha.html` como está. Fora do escopo desta feature.

**Por quê:** Spec EXT-* é exclusivamente sobre o extrator. Migrar ficha junto vira escopo creep e a feature pode regressar a `ficha` sem ter sido planejada. Anotar como **follow-up**: criar feature/PR separada pra abrir o gate da ficha do mesmo jeito (provavelmente reusa o mesmo padrão/key).

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `extrator.html` | Gate de 1 input → 3 inputs; captureGateSubmit substitui checkGateEmail; remove `gate-not-found` state; banner pós-submit pro grupo; URL+key no JS |
| `_deploy/extrator.html` | Espelho byte-igual da raiz |
| `tracker.js` | URL: `core-api.roisemhype.cloud` → `nucleo-api.roicomia.com`. KEY: nova key dedicada `nuc_1d424740...` |
| `_deploy/tracker.js` | Espelho byte-igual da raiz |
| `.specs/features/extrator-captura-aberta/flow-log.md` | Este arquivo |

## Smoke tests rodados (contra prod)

| # | Endpoint | Headers | Body | Esperado | Resultado |
|---|----------|---------|------|----------|-----------|
| 1 | `POST /public/tracking/extrator-signup` | Key gate | payload válido | 200 + leadId | ✅ leadId `2541f77c...` |
| 2 | `POST /public/tracking/init` | Key tracker | `{pageUrl}` | 200 + leadId | ✅ leadId `f3ae108d...` |
| 3 | `POST /public/tracking/events` | Key tracker | `{leadId,event}` (UUID inválido) | 400 validação | ✅ Zod issue UUID |

## Validação manual pendente (responsabilidade do user)

Quando este PR for mergeado e Cloudflare Pages atualizar:

1. Abrir `https://lp.roicomia.com/extrator` em **Chrome desktop** + **Safari iOS** (real device ou simulator)
2. Golden path: preencher 3 campos válidos → liberar → preencher 20 perguntas → submit → confirmação
3. Edge cases:
   - Phone duplicado (usar `11988887777` que já tem lead `a510f910...` em prod) → deve liberar mas não duplicar
   - Phone inválido (formato curto) → bloqueia client-side com mensagem inline
   - Email inválido → bloqueia client-side com mensagem inline
   - Network desconectada (DevTools → Offline) → mensagem inline em `#gate-err`, botão reabilita, sem retry automático
4. Conferir no Kanban (`https://nucleo.roicomia.com/comercial/leads`) que lead novo aparece com `source='lp-roicomia-extrator'` + tag `extrator-direto`

## Bloqueios

Nenhum.
