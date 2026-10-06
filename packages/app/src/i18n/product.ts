// Explicit English fallback for product copy awaiting locale review.
export const PRODUCT_ENGLISH = {
  "product.projects.incompatible":
    "This server does not provide the project API. Connect to the current Oreshnik backend.",
  "product.projects.denied":
    "The server cannot access the workspace root. Check its filesystem permissions or dev root configuration.",
  "product.projects.network": "Cannot reach the project server. Check the server connection.",
  "product.projects.auth": "The server rejected authentication. Check the server credentials.",
  "product.projects.listFailed": "Could not list projects ({{code}}).",
  "product.projects.createFailed": "Could not create the project directory ({{code}}).",
  "product.projects.sessionFailed":
    "The project exists, but creating its chat failed ({{code}}). Choose the existing project to try again.",
  "product.projects.navigationFailed": "The chat was created, but could not be opened. Open it from Recent sessions.",
  "product.projects.choose": "Where shall we work?",
  "product.projects.create": "Create project",
  "product.projects.existing": "Existing projects",
  "product.projects.name": "Project name",
  "product.projects.exists": "This project already exists. Choose it from the project list.",
  "product.projects.invalid": "Enter a name without paths, dots, slashes or special characters (up to 120 bytes).",
  "product.projects.failed":
    "Could not open this project. Check the connection and workspace permissions, then try again.",
  "app.name": "Oreshnik",
  "workspace.files.title": "Workspace",
  "workspace.files.open": "Workspace files",
  "workspace.files.close": "Collapse workspace files",
  "workspace.files.refresh": "Refresh files",
  "workspace.files.upload": "Upload files",
  "workspace.files.drop": "Drop files here",
  "workspace.files.dropHint": "They will be added to this workspace",
  "workspace.files.needSession": "Send a message to start this chat before uploading files.",
  "workspace.files.exists": "{{name}} already exists. Rename your file before uploading.",
  "workspace.files.tooLarge": "{{name}} exceeds the 20 MB limit.",
  "workspace.files.failed":
    "Could not upload {{name}}. Check the connection, filename and workspace permissions, then try again.",
  "workspace.files.noFolders": "Folder uploads are not supported. Select individual files.",
  "app.openTabs": "Open tabs",
}
