# PF Alerta de citas

Consulta cada 30 minutos (GitHub Actions) si hay citas libres en el Sistema de Agendamento
de la Polícia Federal y avisa por Telegram.

- Unidad: `183` — DELEMIG/DREX/SR/PF/PR (Curitiba)
- Servicio: `2` — Refúgio (Requerimentos Diversos: renovação, 1º RNM, correção)

Secrets necesarios: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`.

Probar en local:

```
$env:TELEGRAM_TOKEN='...'; $env:TELEGRAM_CHAT_ID='...'; node pf-alerta.js --test
```
