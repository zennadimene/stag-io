
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getSmartRecommendations,
  getQuickRecommendations,
  trackInteraction,
  provideFeedback
} = require('../controllers/matchingController');

router.use(protect);

router.get('/recommendations', getSmartRecommendations);

router.get('/quick', getQuickRecommendations);

router.post('/track', trackInteraction);

router.post('/feedback', provideFeedback);

module.exports = router;