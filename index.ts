import {
  CreateVirtualMFADeviceCommand,
  EnableMFADeviceCommand,
  IAMClient,
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { Credentials, Provider } from "@aws-sdk/types";
import { unlink } from "fs/promises";
import inquirer from "inquirer";
import open from "open";
import tempy from "tempy";
import { AwsVaultCredentials } from "./AwsVaultCredentials.js";

let credentials: Provider<Credentials> | Credentials;

const profileName = process.argv[2];
if (profileName) {
  credentials = AwsVaultCredentials.provide({
    profileName,
    noSession: true,
  });
} else if (
  !process.env.AWS_ACCESS_KEY_ID ||
  !process.env.AWS_SECRET_ACCESS_KEY
) {
  console.error(
    `must specify aws-vault profile name or provide credentials in environment`
  );
  process.exit(1);
} else if (process.env.AWS_SESSION_TOKEN) {
  console.error(`this tool cannot be run with a session`);
  process.exit(1);
} else {
  credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const sts = new STSClient({ credentials });
const iam = new IAMClient({ credentials });

const { Arn: identity } = await sts.send(new GetCallerIdentityCommand({}));
if (!identity) {
  throw new Error(`unable to retrieve current user identity`);
}

const match = /^arn:.*user\/(.*)$/.exec(identity);
if (!match) {
  throw new Error(`current user identity '${identity}' is not a user`);
}

const name = match[1];
console.log(`current user is ${name}`);

const { VirtualMFADevice: mfa } = await iam.send(
  new CreateVirtualMFADeviceCommand({ VirtualMFADeviceName: name })
);
if (!mfa?.QRCodePNG) {
  throw new Error(`unable to add virtual MFA device`);
}

const qrCodePath = await tempy.write(mfa.QRCodePNG, {
  extension: ".png",
});

console.log(`opening QR code file: ${qrCodePath}`);
open(qrCodePath);

const { code1, code2 } = await inquirer.prompt([
  {
    name: "code1",
    type: "text",
    prompt: "Enter MFA code 1",
  },
  {
    name: "code2",
    type: "text",
    prompt: "Enter MFA code 2",
  },
]);

await iam.send(
  new EnableMFADeviceCommand({
    AuthenticationCode1: code1,
    AuthenticationCode2: code2,
    SerialNumber: mfa.SerialNumber,
    UserName: name,
  })
);

console.log(`MFA device ${mfa.SerialNumber} configured`);

await unlink(qrCodePath);
