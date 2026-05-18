const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { protect } = require('../middleware/authMiddleware');

router.get('/api/company/applications', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    console.log('📋 Company ID:', companyId);

    const [applications] = await db.execute(`
      SELECT 
        si.id,
        si.student_id,
        si.internship_id,
        si.status,
        si.applied_at as applied_date,
        si.feedback,
        si.interview_date,
        si.interview_time,
        si.interview_mode,
        i.title as internship_title,
        i.location as internship_location,
        i.company_id,
        u.id as student_user_id,
        u.email as student_email,
        s.first_name,
        s.last_name,
        s.university,
        s.specialization,
        s.year_of_study,
        s.skills,
        s.phone as student_phone
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN users u ON si.student_id = u.id
      LEFT JOIN students s ON si.student_id = s.user_id
      WHERE i.company_id = ?
      ORDER BY si.applied_at DESC
    `, [companyId]);

    console.log(`✅ Found ${applications.length} applications`);

    const parsedApplications = applications.map(app => ({
      id: app.id,
      student_id: app.student_id,
      internship_id: app.internship_id,
      status: app.status,
      applied_date: app.applied_date,
      feedback: app.feedback,
      interview_date: app.interview_date,
      interview_time: app.interview_time,
      interview_mode: app.interview_mode,
      meeting_link: null,
      internship_title: app.internship_title,
      internship_location: app.internship_location,
      company_id: app.company_id,
      student_user_id: app.student_user_id,
      student_email: app.student_email,
      student_name: `${app.first_name || ''} ${app.last_name || ''}`.trim() || 'Unknown Student',
      first_name: app.first_name,
      last_name: app.last_name,
      university: app.university,
      specialization: app.specialization,
      year_of_study: app.year_of_study,
      skills: app.skills ? JSON.parse(app.skills) : [],
      student_phone: app.student_phone
    }));

    res.json({ 
      success: true, 
      applications: parsedApplications
    });

  } catch (error) {
    console.error('🔥 Error fetching applications:', {
      message: error.message,
      sqlMessage: error.sqlMessage
    });
    
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching applications'
    });
  }
});


router.get('/api/company/applications/stats', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    console.log('📊 Fetching stats for company:', companyId);

    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN si.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN si.status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
        SUM(CASE WHEN si.status = 'interview' THEN 1 ELSE 0 END) as interview,
        SUM(CASE WHEN si.status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN si.status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      WHERE i.company_id = ?
    `, [companyId]);

    console.log('📊 Stats result:', stats[0]);

    const result = stats[0] || {
      total: 0, pending: 0, reviewed: 0, interview: 0, accepted: 0, rejected: 0
    };

    const cleanStats = {
      total: Number(result.total) || 0,
      pending: Number(result.pending) || 0,
      reviewed: Number(result.reviewed) || 0,
      interview: Number(result.interview) || 0,
      accepted: Number(result.accepted) || 0,
      rejected: Number(result.rejected) || 0
    };

    res.json({ 
      success: true, 
      stats: cleanStats
    });

  } catch (error) {
    console.error('🔥 Error fetching stats:', {
      message: error.message,
      sqlMessage: error.sqlMessage
    });
    
    res.json({ 
      success: true, 
      stats: {
        total: 0,
        pending: 0,
        reviewed: 0,
        interview: 0,
        accepted: 0,
        rejected: 0
      }
    });
  }
});

router.get('/api/company/student/:studentId', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const studentId = req.params.studentId;
    console.log('👤 Fetching student profile for ID:', studentId);

    const [students] = await db.execute(`
      SELECT 
        s.user_id as id,
        s.first_name,
        s.last_name,
        s.university,
        s.specialization,
        s.year_of_study,
        s.wilaya,
        s.phone,
        s.bio,
        s.social_security,
        s.academic_supervisor,
        s.skills,
        s.github_link as github_url,
        s.linkedin_link as portfolio_url,
        s.profile_image_url,
        s.created_at,
        s.experiences,  -- ✅ أضف هذا السطر
        u.email
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id = ?
    `, [studentId]);

    if (students.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    const student = students[0];
    
    // ✅ تحويل skills من JSON إلى مصفوفة
    let skills = [];
    if (student.skills) {
      try {
        skills = JSON.parse(student.skills);
      } catch (e) {
        skills = typeof student.skills === 'string' ? student.skills.split(',').map(s => s.trim()) : [];
      }
    }
    
    // ✅ تحويل experiences من JSON إلى مصفوفة
    let experiences = [];
    if (student.experiences) {
      try {
        experiences = typeof student.experiences === 'string' 
          ? JSON.parse(student.experiences) 
          : student.experiences;
      } catch (e) {
        experiences = [];
      }
    }

    const [applications] = await db.execute(`
      SELECT 
        si.id,
        si.internship_id,
        si.status,
        si.applied_at as applied_date,
        i.title as internship_title,
        i.company_id,
        c.company_name
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE si.student_id = ?
      ORDER BY si.applied_at DESC
    `, [studentId]);

    console.log(`✅ Found student: ${student.first_name} ${student.last_name}`);

    res.json({
      success: true,
      student: {
        ...student,
        skills,
        experiences  // ✅ أضف هذا السطر
      },
      applications
    });

  } catch (error) {
    console.error('🔥 Error fetching student profile:', {
      message: error.message,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student profile' 
    });
  }
});

module.exports = router;