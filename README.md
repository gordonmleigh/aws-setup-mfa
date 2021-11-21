# aws-setup-mfa

This is a tool to easily set up MFA for an AWS IAM account. It support getting credentials from [aws-vault](https://github.com/99designs/aws-vault) or elsewhere.

## Usage

To use aws-vault automatically:

```bash
aws-setup-mfa AWS_VAULT_PROFILE_NAME
```

If the profile name is omitted, then the credentials should be passed in the environment.
