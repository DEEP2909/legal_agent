import { adminService } from "./services/admin.service.js";
import { authService } from "./services/auth.service.js";
import { documentService } from "./services/document.service.js";
import { platformService } from "./services/platform.service.js";
import { scimService } from "./services/scim.service.js";

export const legalWorkflowService = {
  ...authService,
  ...documentService,
  ...adminService,
  ...scimService,
  ...platformService
};
