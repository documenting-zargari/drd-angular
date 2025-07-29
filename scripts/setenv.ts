import { writeFile } from 'fs';
import yargs from 'yargs';
import * as dotenv from 'dotenv';

const argv = yargs(process.argv.slice(2)).parseSync();

// read environment variables from .env file
dotenv.config();

// read the command line arguments passed with yargs
const environment = (argv as { environment?: string }).environment;
const isProduction = environment === 'prod';

const targetPath = isProduction
   ? `./src/environments/environment.prod.ts`
   : `./src/environments/environment.ts`;

// we have access to our environment variables
// in the process.env object thanks to dotenv
const environmentFileContent = `
export const environment = {
   production: ${isProduction},
   countryApiToken: "${process.env['COUNTRY_API_TOKEN']}",
   countryApiUrl: "https://aaapis.com/api/v1/info/country/",
   apiUrl: "${process.env['API_URL']}",
   audioUrl: "${process.env['AUDIO_URL']}"
};
`;

// write the content to the respective file
writeFile(targetPath, environmentFileContent, function (err) {
   if (err) {
      console.log(err);
   }

   console.log(`Wrote variables to ${targetPath}`);
});
