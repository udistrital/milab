require('dotenv').config();

function getRegistrationTokenSecret() {
  return process.env.REGISTRATION_TOKEN_SECRET;
}

module.exports = {
  getRegistrationTokenSecret,
};
