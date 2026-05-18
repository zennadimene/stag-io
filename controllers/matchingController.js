
const MatchingService = require('../services/matchingService');
const db = require('../config/database');

const getSmartRecommendations = async (req, res) => {
  try {
    const studentId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    const recommendations = await MatchingService.getSmartRecommendations(studentId, limit);
    
    res.json({
      success: true,
      recommendations,
      count: recommendations.length
    });
    
  } catch (error) {
    console.error('❌ Error in getSmartRecommendations:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting recommendations',
      error: error.message
    });
  }
};


const getQuickRecommendations = async (req, res) => {
  try {
    const studentId = req.user.id;
    
    const recommendations = await MatchingService.getSmartRecommendations(studentId, 3);
    
    res.json({
      success: true,
      recommendations
    });
    
  } catch (error) {
    console.error('❌ Error in getQuickRecommendations:', error);
    res.json({
      success: true,
      recommendations: []
    });
  }
};

const trackInteraction = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { internshipId, action } = req.body; 
    
    if (action === 'view') {
      await db.execute(
        'UPDATE internships SET views_count = views_count + 1 WHERE id = ?',
        [internshipId]
      );
    } else if (action === 'apply') {
      await db.execute(
        'UPDATE internships SET applications_count = applications_count + 1 WHERE id = ?',
        [internshipId]
      );
    }
    

    await MatchingService.updateStudentPreferences(studentId, internshipId, action);
   
    res.json({
      success: true,
      message: 'Interaction tracked successfully'
    });
    
  } catch (error) {
    console.error('❌ Error tracking interaction:', error);
    res.status(500).json({
      success: false,
      message: 'Error tracking interaction'
    });
  }
};

const provideFeedback = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { internshipId, helpful, reason } = req.body;
    
    await db.execute(
      `INSERT INTO recommendation_feedback 
       (student_id, internship_id, helpful, reason, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [studentId, internshipId, helpful, reason || null]
    );
    
    res.json({
      success: true,
      message: 'Thank you for your feedback!'
    });
    
  } catch (error) {
    console.error('❌ Error saving feedback:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving feedback'
    });
  }
};

module.exports = {
  getSmartRecommendations,
  getQuickRecommendations,
  trackInteraction,
  provideFeedback
};