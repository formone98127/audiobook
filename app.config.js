/** @type {import('expo/config').ExpoConfig} */
module.exports = () => {
  const { expo } = require('./app.json');
  const ghPages = process.env.GITHUB_PAGES === '1';
  return {
    ...expo,
    experiments: {
      ...expo.experiments,
      ...(ghPages ? { baseUrl: '/audiobook' } : {}),
    },
  };
};
