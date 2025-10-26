const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB
const { uploadFile } = require('../controllers/uploads.controller');

// POST /api/uploads  (form field: file)
router.post('/', upload.single('file'), uploadFile);

module.exports = router;
