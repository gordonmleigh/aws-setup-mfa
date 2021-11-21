import { Credentials, Provider } from "@aws-sdk/types";
import childproc from "child_process";

export interface AwsVaultCredentialsOptions {
  awsVaultPath?: string;
  durationSeconds?: number;
  guiPrompt?: boolean;
  mfaToken?: string;
  noSession?: boolean;
  profileName: string;
  prompt?: string;
}

interface AwsCredentialInfo {
  AccessKeyId: string;
  Expiration?: string;
  SecretAccessKey: string;
  SessionToken?: string;
  Version: number;
}

export class AwsVaultCredentials {
  public static provide(
    opts: AwsVaultCredentialsOptions
  ): Provider<Credentials> {
    return new AwsVaultCredentials(opts).getCredentials;
  }

  private readonly callAwsVault: () => PromiseLike<AwsCredentialInfo>;

  constructor(private readonly opts: AwsVaultCredentialsOptions) {
    // multiple concurrent calls are joined together to provide one result
    this.callAwsVault = joinConcurrentCallers(this._nosync_callAwsVault);
  }

  public readonly getCredentials = async (): Promise<Credentials> => {
    const creds = await this.callAwsVault();
    return {
      accessKeyId: creds.AccessKeyId,
      expiration: creds.Expiration ? new Date(creds.Expiration) : undefined,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    };
  };

  private readonly _nosync_callAwsVault =
    async (): Promise<AwsCredentialInfo> => {
      const args = ["exec", "--json", this.opts.profileName];

      if (this.opts.noSession) {
        args.push("--no-session");
      }
      if (this.opts.prompt) {
        args.push("--prompt");
        args.push(this.opts.prompt);
      } else if (this.opts.guiPrompt) {
        if (process.platform === "darwin") {
          args.push("--prompt");
          args.push("osascript");
        } else if (process.platform === "win32") {
          args.push("--prompt");
          args.push("wincredui");
        }
      }
      if (this.opts.durationSeconds) {
        args.push("--duration");
        args.push(`${this.opts.durationSeconds}s`);
      }

      const proc = childproc.spawn(
        this.opts.awsVaultPath ?? "aws-vault",
        args,
        {
          stdio: ["inherit", "pipe", "pipe"],
        }
      );

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      proc.stderr.on("data", (chunk) => {
        // follow the stderr to console so that the MFA prompt still works
        process.stderr.write(chunk);
        stderr.push(chunk);
      });
      proc.stdout.on("data", (chunk) => stdout.push(chunk));

      return new Promise((resolve, reject) => {
        proc.on("error", reject);

        proc.on("exit", (code) => {
          if (code) {
            const err = Buffer.concat(stderr).toString();
            throw new Error(`aws-vault exited with status ${code}: ${err}`);
          }
          try {
            const result = JSON.parse(Buffer.concat(stdout).toString());
            resolve(result);
          } catch (err) {
            throw new Error(`aws-vault returned unexpected output: ${err}`);
          }
        });
      });
    };
}

function joinConcurrentCallers<Result>(
  fn: () => PromiseLike<Result>
): () => PromiseLike<Result> {
  let current: PromiseLike<Result> | undefined;

  return async (): Promise<Result> => {
    if (current) {
      return await current;
    }
    try {
      current = fn();
      return await current;
    } finally {
      current = undefined;
    }
  };
}
