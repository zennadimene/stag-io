const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { protect } = require('../middleware/authMiddleware');

router.get('/api/admin/notifications', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const [notifications] = await db.execute(`
      SELECT 
        n.*,
        c.company_name,
        s.first_name as student_first_name,
        s.last_name as student_last_name,
        i.title as internship_title
      FROM admin_notifications n
      LEFT JOIN companies c ON n.company_id = c.user_id
      LEFT JOIN students s ON n.student_id = s.user_id
      LEFT JOIN internships i ON n.internship_id = i.id
      ORDER BY n.created_at DESC
    `);

    res.json({
      success: true,
      notifications
    });

  } catch (error) {
    console.error('🔥 Error fetching notifications:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching notifications' 
    });
  }
});


router.put('/api/admin/notifications/:id/read', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const { id } = req.params;

    await db.execute(
      'UPDATE admin_notifications SET is_read = 1 WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('🔥 Error marking notification:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking notification' 
    });
  }
});

router.put('/api/admin/notifications/read-all', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    await db.execute('UPDATE admin_notifications SET is_read = 1');

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('🔥 Error marking all notifications:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking notifications' 
    });
  }
});


router.get('/api/admin/notifications/unread-count', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const [result] = await db.execute(
      'SELECT COUNT(*) as count FROM admin_notifications WHERE is_read = 0'
    );

    res.json({
      success: true,
      count: result[0].count
    });

  } catch (error) {
    console.error('🔥 Error fetching unread count:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching count' 
    });
  }
});

/*
router.get('/api/admin/stats', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const [companies] = await db.execute(
      "SELECT COUNT(*) as count FROM users WHERE user_type = 'company'"
    );

    const [students] = await db.execute(
      "SELECT COUNT(*) as count FROM users WHERE user_type = 'student'"
    );

    const [internships] = await db.execute(
      "SELECT COUNT(*) as count FROM internships"
    );

    const [notifications] = await db.execute(
      "SELECT COUNT(*) as count FROM admin_notifications WHERE is_read = 0"
    );

    console.log('📊 Stats:', {
      companies: companies[0].count,
      students: students[0].count,
      internships: internships[0].count,
      pending: notifications[0].count
    });

    res.json({
      success: true,
      stats: {
        totalCompanies: companies[0].count,
        totalStudents: students[0].count,
        totalInternships: internships[0].count,
        pendingAcceptances: notifications[0].count
      }
    });

  } catch (error) {
    console.error('🔥 Error fetching stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching stats' 
    });
  }
});
*/

module.exports = router;