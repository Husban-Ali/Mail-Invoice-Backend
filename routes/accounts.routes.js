const express = require('express');
const router = express.Router();
const accountsController = require('../controllers/accountController');
const { getUsers, updateUserStatus, getUserProfile, updateUserProfile } = require('../controllers/accountController');

// User management endpoints
router.get('/users', getUsers);
router.patch('/users/:userId/status', updateUserStatus);

// User profile endpoints
router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);

router.post('/', accountsController.createAccount);
router.get('/', accountsController.listAccounts);
router.get('/:id', accountsController.getAccount);
router.put('/:id', accountsController.updateAccount);
router.delete('/:id', accountsController.deleteAccount);

module.exports = router;
