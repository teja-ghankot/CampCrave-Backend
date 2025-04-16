const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true
  },
  email: String,
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    default: 'Student'
  },

  // 🪙 Wallet Section
  wallet: {
    balance: {
      type: Number,
      default: 0 // initial coins
    },
    transactions: [
      {
        type: {
          type: String, // "credit" or "debit"
          enum: ['credit', 'debit'],
          required: true
        },
        amount: {
          type: Number,
          required: true
        },
        timestamp: {
          type: Date,
          default: Date.now
        },
        razorpayPaymentId: String,
        description: String
      }
    ]
  }
});

module.exports = mongoose.model('User', userSchema);
