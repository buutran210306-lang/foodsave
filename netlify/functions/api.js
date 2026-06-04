const serverless = require('serverless-http');

// Trỏ Netlify tìm đến file app.js trong thư mục dist (sau khi build từ src/app.ts)
const appModule = require('../../dist/app');
const app = appModule.default || appModule.app || appModule;

// Khởi tạo handler bọc toàn bộ hệ thống Express của bạn
exports.handler = serverless(app);