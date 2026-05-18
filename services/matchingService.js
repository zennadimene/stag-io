
const db = require('../config/database');

class MatchingService {
  
 
  static parseSkills(skills) {
    if (!skills) return [];
    
    if (Array.isArray(skills)) {
      return skills.map(s => String(s).toLowerCase().trim());
    }
    
    if (typeof skills === 'string') {
      try {
        const parsed = JSON.parse(skills);
        if (Array.isArray(parsed)) {
          return parsed.map(s => String(s).toLowerCase().trim());
        }
      } catch (e) {
        
        if (skills.includes(',')) {
          return skills.split(',').map(s => s.trim().toLowerCase().replace(/[\[\]"]/g, ''));
        }
      }
    }
    
    return [];
  }


static calculateMatchScore(student, internship) {
  let score = 0;
  
  const studentSkills = this.parseSkills(student.skills);
  const requiredSkills = this.parseSkills(internship.required_skills);
  
  if (studentSkills.length > 0 && requiredSkills.length > 0) {
    let matchedSkills = 0;
    requiredSkills.forEach(skill => {
      if (studentSkills.includes(skill)) {
        matchedSkills++;
      }
    });
    
    const skillMatchPercentage = (matchedSkills / requiredSkills.length) * 100;
    
    if (matchedSkills === requiredSkills.length) {
      score = 100;
      console.log(`📊 Skills match: ${matchedSkills}/${requiredSkills.length} = 100% -> PERFECT MATCH!`);
      return 100;  
    }
    
    score = (skillMatchPercentage / 100) * 80;
    
    console.log(`📊 Skills match: ${matchedSkills}/${requiredSkills.length} = ${skillMatchPercentage}% -> Base score: ${score}`);
  } else if (requiredSkills.length === 0) {
    
    score = 50;
    console.log(`📊 No skills required -> Base score: 50%`);
  }

  if (student.wilaya && internship.location) {
  if (student.wilaya.toLowerCase() === internship.location.toLowerCase()) {
    score += 10;
    console.log(`📍 Location bonus: +10% (same wilaya)`);
  }
} else if (internship.type === 'remote') {
  score += 5;
  console.log(`🌐 Remote bonus: +5%`);
}

if (student.specialization && internship.title) {
  const spec = student.specialization.toLowerCase();
  const title = internship.title.toLowerCase();
  
  if (title.includes(spec) || spec.includes(title)) {
    score += 10;
    console.log(`🎓 Specialization bonus: +10%`);
  }
}

  const finalScore = Math.min(Math.round(score), 100);
  console.log(`📊 Final score: ${finalScore}%`);
  return finalScore;
}



  
  static getMatchReason(score, student, internship, requiredSkills) {
    const reasons = [];
    
    const studentSkills = this.parseSkills(student.skills);
    const parsedRequiredSkills = this.parseSkills(requiredSkills);
    
    if (parsedRequiredSkills.length > 0) {
      const matchedSkills = parsedRequiredSkills.filter(skill => 
        studentSkills.includes(skill)
      );
      
      if (matchedSkills.length > 0) {
        reasons.push(`📌 Matches your skills: ${matchedSkills.slice(0, 3).join(', ')}`);
      }
    }
    
    if (student.wilaya && internship.location === student.wilaya) {
      reasons.push(`📍 In your wilaya: ${student.wilaya}`);
    } else if (internship.type === 'remote') {
      reasons.push('🌐 Can work remotely');
    }
    
    if (student.specialization && internship.title && 
        internship.title.toLowerCase().includes(student.specialization.toLowerCase())) {
      reasons.push(`🎓 Fits your specialization: ${student.specialization}`);
    }
    
    if (reasons.length === 0) {
      if (score >= 80) reasons.push('✨ Excellent match for your profile');
      else if (score >= 60) reasons.push('👍 Good opportunity matching your skills');
      else reasons.push('🔍 This opportunity might suit you');
    }
    
    return reasons;
  }

  
  static async getSmartRecommendations(studentId, limit = 10) {
    try {
      console.log(`🔍 Getting recommendations for student ${studentId}`);
      
      const [studentRows] = await db.execute(`
        SELECT 
          s.user_id,
          s.first_name,
          s.last_name,
          s.skills,
          s.specialization,
          s.wilaya,
          s.university
        FROM students s
        WHERE s.user_id = ?
      `, [studentId]);

      if (studentRows.length === 0) {
        console.log('❌ Student not found');
        return [];
      }

      const student = studentRows[0];
      console.log('📊 Student skills (raw):', student.skills);
      
      const [appliedRows] = await db.execute(`
        SELECT internship_id FROM student_internships WHERE student_id = ?
      `, [studentId]);
      const appliedIds = appliedRows.map(a => a.internship_id);

      const [savedRows] = await db.execute(`
        SELECT internship_id FROM saved_internships WHERE student_id = ?
      `, [studentId]);
      const savedIds = savedRows.map(s => s.internship_id);
      
      const excludedIds = [...appliedIds, ...savedIds];

      let sql = `
        SELECT 
          i.*,
          c.company_name,
          c.logo_url,
          c.wilaya as company_location
        FROM internships i
        JOIN companies c ON i.company_id = c.user_id
        WHERE i.status = 'active'
      `;
      
      const params = [];
      
      if (excludedIds.length > 0) {
        sql += ` AND i.id NOT IN (${excludedIds.map(() => '?').join(',')})`;
        params.push(...excludedIds);
      }
      
      sql += ` ORDER BY i.created_at DESC LIMIT 50`;
      
      const [internships] = await db.execute(sql, params);

    console.log('🔍 ALL ACTIVE INTERNSHIPS:', internships.map(i => ({ id: i.id, title: i.title })));
    console.log('🔍 EXCLUDED IDS:', excludedIds);
    console.log(`📊 Found ${internships.length} active internships`);

      const recommendations = [];
      
      for (const internship of internships) {
        const matchScore = this.calculateMatchScore(student, internship);
        
        if (matchScore > 20) {
          const reason = this.getMatchReason(
            matchScore, 
            student, 
            internship, 
            internship.required_skills
          );
          
recommendations.push({
    ...internship,
    required_skills: this.parseSkills(internship.required_skills),
    match_score: matchScore,
   match_level: matchScore >= 90 ? 'excellent' : 
             matchScore >= 70 ? 'good' : 
             matchScore >= 50 ? 'fair' : 'poor',
    reason: reason
});
        }
      }
      
      recommendations.sort((a, b) => b.match_score - a.match_score);
      
      console.log(`✅ Found ${recommendations.length} recommendations`);
      
console.log('🔴🔴🔴 FINAL RECOMMENDATIONS WITH LEVELS:');
recommendations.slice(0, limit).forEach(r => {
    console.log(`${r.title}: ${r.match_score}% -> ${r.match_level}`);
});
      return recommendations.slice(0, limit);

    } catch (error) {
      console.error('❌ Error in smart recommendations:', error);
      return [];
    }
  }

static async updateStudentPreferences(studentId, internshipId, action) {
  try {
 
    const [internships] = await db.execute(
      'SELECT required_skills FROM internships WHERE id = ?',
      [internshipId]
    );
    
    if (internships.length === 0) return;
    
    const internshipSkills = this.parseSkills(internships[0].required_skills);
    
    if (internshipSkills.length === 0) return;
    
    const [students] = await db.execute(
      'SELECT skills FROM students WHERE user_id = ?',
      [studentId]
    );
    
    if (students.length === 0) return;
    
    let currentSkills = this.parseSkills(students[0].skills);
    
    if (action === 'save' || action === 'apply') {
      const newSkills = [...currentSkills];
      internshipSkills.forEach(skill => {
        if (!newSkills.includes(skill)) {
          newSkills.push(skill);
        }
      });
      
      if (newSkills.length > currentSkills.length) {
        await db.execute(
          'UPDATE students SET skills = ? WHERE user_id = ?',
          [JSON.stringify(newSkills), studentId]
        );
        console.log(`✅ Updated student skills based on ${action} action`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error updating student preferences:', error);
  }
}

}

module.exports = MatchingService;