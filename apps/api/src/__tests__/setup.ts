// Test environment setup - provides required environment variables for tests
// These are test-only values and should never be used in production

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";
process.env.OPENAI_API_KEY = "test-openai-api-key-for-testing-only";
process.env.DEMO_API_KEY = "test-demo-api-key-for-testing-only";
process.env.DEMO_USER_EMAIL = "test@example.com";
process.env.DEMO_USER_PASSWORD = "TestPassword123!";
// These must be exactly 32+ characters for AES-256 encryption
process.env.APP_ENCRYPTION_KEY = "abcdefghijklmnopqrstuvwxyz123456";
process.env.JWT_SECRET = "jwt-secret-key-must-be-32-chars!";
process.env.PLATFORM_ADMIN_SECRET = "platform-admin-must-be-32-chars!";
process.env.WEB_APP_URL = "http://localhost:3000";
process.env.API_BASE_URL = "http://localhost:3001";

