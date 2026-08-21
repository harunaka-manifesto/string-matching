import { KeyManagementServiceClient } from '@google-cloud/kms';

export interface SecretCipher {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}

export class GoogleKmsCipher implements SecretCipher {
  private readonly client = new KeyManagementServiceClient();
  constructor(private readonly keyName: string) {}
  async encrypt(value: string): Promise<string> {
    const [response] = await this.client.encrypt({
      name: this.keyName,
      plaintext: Buffer.from(value),
    });
    return Buffer.from(response.ciphertext as Uint8Array).toString('base64');
  }
  async decrypt(value: string): Promise<string> {
    const [response] = await this.client.decrypt({
      name: this.keyName,
      ciphertext: Buffer.from(value, 'base64'),
    });
    return Buffer.from(response.plaintext as Uint8Array).toString('utf8');
  }
}

export class IdentityCipher implements SecretCipher {
  async encrypt(value: string) {
    return value;
  }
  async decrypt(value: string) {
    return value;
  }
}
