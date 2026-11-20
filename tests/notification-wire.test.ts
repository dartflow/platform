import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationWireData} from '../lib/notification-wire';
import {notificationText} from '../lib/notification-core';
import type {Communication} from '../lib/notification-events';
const row=(communication:Communication,category='Supporttickets',template_id='support-answered')=>({template_id,category,reference:{templateId:template_id,eventId:'synthetic',recipientId:null,communication}});
test('support lockscreen projection cannot contain subject, message or staff identity',()=>{
 const communication:Communication={reference:{kind:'support',ticketId:'00000000-0000-4000-8000-000000000001',ticketNumber:'DF-1003',recipientView:'user'},title:'Private subject',body:'Private staff message and identity',href:'/app/support/private'};
 assert.deepEqual(notificationWireData(row(communication)),{eventType:'support-answered',ticketNumber:'DF-1003'});
 assert.deepEqual(notificationWireData(row(communication,'Supporttickets','support-received')),{});
 if(communication.reference.kind!=='support')throw Error('Expected support reference'); communication.reference.ticketNumber='DF-1003\nPrivate';assert.deepEqual(notificationWireData(row(communication)),{});
});
test('campaign lockscreen text is bounded and requires the correct event category and reference',()=>{
 const communication:Communication={reference:{kind:'campaign',campaignId:'00000000-0000-4000-8000-000000000001',product:'dartflow',channel:'all'},title:'Nieuwe versie',body:'Open de gepubliceerde release.',href:'/app/whats-new/id'};
 assert.deepEqual(notificationWireData(row(communication,'Productreleases','product-release')),{campaignTitle:communication.title,campaignBody:communication.body});
 assert.deepEqual(notificationWireData(row(communication)),{});communication.body='x'.repeat(181);assert.deepEqual(notificationWireData(row(communication,'Platformberichten','platform-message')),{});
 communication.body='verborgen\nextra';assert.deepEqual(notificationWireData(row(communication,'Productreleases','product-release')),{});
});
test('legacy messages retain their opaque wire without new data fields',()=>{
 assert.deepEqual(notificationWireData({category:'Sociaal',template_id:'friend-request',reference:{templateId:'friend-request',eventId:'synthetic',recipientId:null}}),{});
});

test('campaign validation rejects the same DEL and C1 controls as the Android receiver',()=>{
 for(const code of [0,31,127,128,159]){const body=`Update${String.fromCharCode(code)}extra`;assert.throws(()=>notificationText(body,180),{code:'invalid_text'});const communication:Communication={reference:{kind:'test',messageId:'00000000-0000-4000-8000-000000000001',product:'dartflow',channel:'all'},title:'DartFlow',body,href:'/app'};assert.deepEqual(notificationWireData(row(communication,'Platformberichten','platform-message')),{});}
 assert.equal(notificationText('Nieuwe versie',80),'Nieuwe versie');
});
