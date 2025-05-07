const fs = require('fs');
const yargs = require('yargs');
require('dotenv').config();

const argv = yargs(process.argv.slice(2)).parse();

// read the command line arguments passed with yargs
const environment = argv.environment;
const isProduction = environment === 'prod';

const targetPath = isProduction
   ? `./src/environments/environment.prod.ts`
   : `./src/environments/environment.ts`;

// prioritize GitHub Actions environment variables over .env file
const environmentFileContent = `
export const environment = {
   production: ${isProduction},
   countryApiToken: "${process.env['COUNTRY_API_TOKEN'] || process.env['DEPLOY_COUNTRY_API_TOKEN']}",
   countryApiUrl: "https://aaapis.com/api/v1/info/country/",
   apiUrl: "${process.env['API_URL'] || process.env['K8S_SECRET_API_URL']}",
};
`;

// write the content to the respective file
fs.writeFile(targetPath, environmentFileContent, function (err) {
   if (err) {
      console.log(err);
   }

   console.log(`Wrote variables to ${targetPath}`);
});