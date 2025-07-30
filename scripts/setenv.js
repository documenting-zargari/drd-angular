const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
require('dotenv').config();

const argv = yargs(process.argv.slice(2)).parse();
const environment = argv.environment;
const isProduction = environment === 'prod';

const targetDir = path.resolve(__dirname, '../src/environments');
const targetPath = isProduction
   ? path.join(targetDir, 'environment.prod.ts')
   : path.join(targetDir, 'environment.ts');

// Ensure the directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const environmentFileContent = `
export const environment = {
   production: ${isProduction},
   countryApiToken: "${process.env['COUNTRY_API_TOKEN']}",
   countryApiUrl: "https://aaapis.com/api/v1/info/country/",
   apiUrl: "${process.env['API_URL']}",
   audioUrl: "${process.env['AUDIO_URL'] || '/mp3'}"
};
`;

fs.writeFile(targetPath, environmentFileContent, function (err) {
   if (err) {
      console.log(err);
   }
   console.log(`Wrote variables to ${targetPath}`);
});