const mongoose = require('mongoose');

const SavedInternshipSchema = new mongoose.Schema({
  student_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  internship_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Internship',
    required: true
  },
  saved_at: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  }
});

SavedInternshipSchema.index({ student_id: 1, internship_id: 1 }, { unique: true });

module.exports = mongoose.model('SavedInternship', SavedInternshipSchema);