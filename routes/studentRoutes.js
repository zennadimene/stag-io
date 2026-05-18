const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/authMiddleware');
const {
    getProfile,
    updateProfile,
    uploadProfileImage,
    deleteProfileImage,
    savePreferences,
    getPreferences
} = require('../controllers/studentController');

const profileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/profiles/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'profile-' + req.user.id + '-' + uniqueSuffix + ext);
    }
});
/*
const cvStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/cvs/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'cv-' + req.user.id + '-' + uniqueSuffix + '.pdf');
    }
});*/

const imageFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
};

const pdfFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        return cb(null, true);
    }
    cb(new Error('Only PDF files are allowed'));
};

const uploadProfile = multer({
    storage: profileStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, 
    fileFilter: imageFilter
});
/*
const uploadCVFile = multer({
    storage: cvStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, 
    fileFilter: pdfFilter
});*/


router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.post('/profile/image', protect, uploadProfile.single('profile_image'), uploadProfileImage);
router.delete('/profile/image', protect, deleteProfileImage);
router.get('/preferences', protect, getPreferences);
router.put('/preferences', protect, savePreferences);

module.exports = router;