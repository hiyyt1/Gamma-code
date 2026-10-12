# Evidence: Gamma pre-deploy, 2026-10-12

Основной результат и границы: [GAMMA_PRE_DEPLOY_CHECK.md](../../GAMMA_PRE_DEPLOY_CHECK.md).

* `source-sha256.json`: проверенное изменённое рабочее дерево; baseCommit не заменяет эти hashes.
* `ubuntu-packages.json`: фактически установленные обязательные APT packages, включая Calc, Java и lxml.
* `clean-build.log`, `initial-build-oom.log`: реальный Ubuntu build, успешный повтор с heap 4096 и первоначальный OOM.
* `ubuntu-runtime.log`: окончательный real HTTP/SSE smoke, 7 native permissions/delegation/1C tests и 10 настоящих presentation tests от gamma. Exit code контейнера 0, OOMKilled=false.
* `bsl-without-utf8.log`, `missing-calc.log`: подтверждённые причины двух дополнительных ошибок чистого окружения; окончательный результат — в ubuntu-runtime.log.
* `backend-combined-failure.log`: сохранённый нестабильный combined run, не заменён успешным логом. `presentation-isolated-host.log` и Ubuntu log показывают границы повторов.
* `navigation-ubuntu-artifact.log`: все 19 regression tests на production artifact из Ubuntu/Node 22. `navigation.log` — дополнительный host-artifact run.
* Остальные `*.log`: package tests/typechecks. Counts не суммировать как уникальные тесты: часть наборов пересекается.

`runtime-smoke.py` создаёт новые временные state/credentials и слушатели на свободных loopback-портах, запускает только собственные backend/gateway и завершает их в finally. Аргумент — корень проверенного checkout, Bun должен быть в PATH. Не передавать production directories в качестве тестовых state; программа не использует существующие credentials. Платные модели не вызывает.

`container-check.sh` — воспроизводимый эквивалент исполненных этапов с исправлениями, сведёнными в один script. Запускать **только внутри отдельного disposable Ubuntu 24.04 container**, от root внутри контейнера. Он устанавливает APT dependencies и создаёт test users внутри container. Нужны read-only mounts: reviewed source archive в `/source.tar`, этот script в `/check.sh`, `runtime-smoke.py` в `/tmp/gamma-runtime-smoke.py`. Не монтировать host `/etc`, Docker socket или production data. Пример после подготовки полного проверенного source archive:

```bash
docker run --name gamma-predeploy-check --cpus=2 --memory=8g --pids-limit=1024 \
  -v /tmp/gamma-reviewed-source.tar:/source.tar:ro \
  -v "$PWD/docs/audits/evidence/gamma-predeploy-2026-10-12/container-check.sh":/check.sh:ro \
  -v "$PWD/docs/audits/evidence/gamma-predeploy-2026-10-12/runtime-smoke.py":/tmp/gamma-runtime-smoke.py:ro \
  ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 bash /check.sh
```

Сначала опубликовать/зафиксировать все необходимые Gamma файлы; `git archive HEAD` старого base commit не содержит untracked installer и потому не воспроизводит проверку. Архив не должен содержать node_modules, credentials, `.env` или production state. Скрипт не является заменой `install-gamma.sh`, не симулирует PID 1 и не доказывает systemd lifecycle. Для повторной VM квалификации следовать deployment CHECKLIST.
