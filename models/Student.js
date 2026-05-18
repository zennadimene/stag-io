const db = require('../config/database');

class Student {
    static async create(studentData) {
        const {
            user_id,
            first_name,
            last_name,
            university_email,
            phone,
            birth_date,
            university,
            specialization,
            year_of_study,
            student_id,
            skills,
            github_link,
            linkedin_link,
            training_type,
            preferred_wilaya,
            expected_start_date,
            profile_image_url 
        } = studentData;

        const [result] = await db.execute(
            `INSERT INTO students (
                user_id, first_name, last_name, university_email, phone, birth_date,
                university, specialization, year_of_study, student_id, skills,
                github_link, linkedin_link, training_type, preferred_wilaya,
                expected_start_date, profile_completed, profile_image_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
            [
                user_id, first_name, last_name, university_email, phone, birth_date,
                university, specialization, year_of_study, student_id,
                JSON.stringify(skills || []),
                github_link, linkedin_link, training_type, preferred_wilaya,
                expected_start_date, profile_image_url || null
            ]
        );
        return result.insertId;
    }

    static async findByUserId(user_id) {
        const [rows] = await db.execute(
            'SELECT * FROM students WHERE user_id = ?',
            [user_id]
        );
        return rows[0];
    }

  static async updateProfile(user_id, updates) {
    const fields = [];
    const values = [];
    
    console.log('📥 Model received updates:', updates);
    
    if (!updates || Object.keys(updates).length === 0) {
        console.log('⚠️ No updates provided, returning success');
        return true;
    }
    
    for (const [key, value] of Object.entries(updates)) {
        // تجاهل undefined, null, وفارغ
        if (value === undefined || value === null || value === '') {
            console.log(`⚠️ Skipping ${key}: value is empty`);
            continue;
        }
        
        if (key === 'skills' && Array.isArray(value)) {
            fields.push(`${key} = ?`);
            values.push(JSON.stringify(value));
            console.log(`✅ Added skills: ${JSON.stringify(value)}`);
        } 
        else if (key === 'soft_skills' && Array.isArray(value)) {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
        console.log(`✅ Added soft_skills: ${JSON.stringify(value)}`);
    }
        
        else {
            fields.push(`${key} = ?`);
            values.push(value);
            console.log(`✅ Added ${key}: ${value}`);
        }
    }
    
    fields.push('updated_at = NOW()');
    
    if (fields.length === 1) {
        console.log('⚠️ No fields to update, but returning success');
        return true;
    }
    
    values.push(user_id);
    const query = `UPDATE students SET ${fields.join(', ')} WHERE user_id = ?`;
    
    console.log('📝 SQL Query:', query);
    console.log('📝 SQL Values:', values);
    
    try {
        const [result] = await db.execute(query, values);
        console.log('✅ Update result:', result);
        return true; 
    } catch (error) {
        console.error('❌ SQL Error:', error);
        throw error;
    }
}

    static async updateProfileImage(user_id, profile_image_url) {
        const [result] = await db.execute(
            'UPDATE students SET profile_image_url = ?, updated_at = NOW() WHERE user_id = ?',
            [profile_image_url, user_id]
        );
        return result.affectedRows > 0;
    }

   /* static async updateCV(user_id, cv_url) {
        const [result] = await db.execute(
            'UPDATE students SET cv_url = ?, updated_at = NOW() WHERE user_id = ?',
            [cv_url, user_id]
        );
        return result.affectedRows > 0;
    }*/

    static async getProfileWithFiles(user_id) {
    const [rows] = await db.execute(
        'SELECT *, profile_image_url,  soft_skills FROM students WHERE user_id = ?',  
        [user_id]
    );
    return rows[0];
}
}

module.exports = Student;
