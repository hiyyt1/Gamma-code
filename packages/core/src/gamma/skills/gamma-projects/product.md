# Проверенные сведения

Проекты создаются через ProductProjects в разрешённом workspace root. Имена проверяются; обход путей и symlink ограничиваются. Несколько чатов могут работать в одном проекте. Пустые неиспользованные сессии могут очищаться; это не удаление наполненной истории. Предпросмотр зависит от типа файла; для PPTX, созданного агентом презентаций, нужен manifest и рендеры. Guide не загружает и не изменяет файлы за пользователя.
Проверено по: packages/opencode/src/server/product-projects.ts; packages/app/src/components/workspace-files.tsx; packages/app/src/components/workspace-file-preview.tsx; packages/app/src/utils/empty-session.ts.
