import configuration from '@/config/android-app-links.json';

/** Public Play app-signing certificates, never upload keystores or fabricated fingerprints. */
type Associations=Record<'production'|'staging',{packageName:string;sha256CertFingerprints:string[]}>;
export function androidAppLinks(environment:string,source:Associations=configuration) {
  if(environment!=='production'&&environment!=='staging')return [];
  const entry=source[environment];
  if(!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(entry.packageName))throw new Error('Invalid Android package configuration.');
  const fingerprints=[...new Set(entry.sha256CertFingerprints as string[])];
  if(fingerprints.some(value=>!/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value)))throw new Error('Invalid public Android signing fingerprint.');
  // The Console application does not exist yet. An empty association cannot falsely verify a test key.
  if(!fingerprints.length)return [];
  return [{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:entry.packageName,sha256_cert_fingerprints:fingerprints}}];
}
