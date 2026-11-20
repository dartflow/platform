import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeNext} from '../lib/config';

test('support, release and inbox links retain their exact destination after sign-in',()=>{
 const id='30000000-0000-4000-8000-000000000001';
 for(const path of ['/app/support','/app/support/new','/app/whats-new','/app/notifications','/app/settings/notifications','/app/admin/support','/app/admin/releases','/app/admin/notifications',...['support','admin/support','whats-new','platform-messages','notifications'].map(section=>`/app/${section}/${id}`)])assert.equal(safeNext(path),path);
 for(const path of ['/app/support/new?next=https://evil.invalid',`/app/support/${id}/internal`,`/app/admin/support/${id}?admin=true`,'/app/support/DF-1003','/app/support/%2e%2e','//evil.invalid/app/support','/app/platform-messages/javascript:alert(1)','/app/admin/anything','/app/whats-new#token'])assert.equal(safeNext(path),'/');
});
