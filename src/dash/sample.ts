// Fictional demo data for the Leads, Content and Inbox pages. Generic names only; addresses sit on example.co.za /
// example.com; no links. Nothing here is a real business or person.
import type { SendChannel } from '../events';
import type { AgentId } from '../types';

export type Grade = 'A' | 'B' | 'C';
export type LeadStatus = 'new' | 'checked' | 'emailed' | 'replied' | 'do-not-contact';
export type InboxClass = 'yes' | 'question' | 'not-now' | 'opt-out';

export interface Lead {
  id: string;
  business: string;
  category: string;
  area: string;
  grade: Grade;
  status: LeadStatus;
  agent: AgentId;
}

export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  cls: InboxClass;
  /** The draft Echo wrote in answer, when there is one (ids match the demo day's drafts). */
  draftId?: string;
}

export interface ScheduleItem {
  day: string;
  channel: SendChannel;
  hook: string;
}

export const LEADS: readonly Lead[] = [
  { id: 'l1', business: 'Harbour Bakery', category: 'Bakery', area: 'Harbour District', grade: 'A', status: 'checked', agent: 'atlas' },
  { id: 'l2', business: 'Green Door Yoga', category: 'Yoga studio', area: 'Garden Quarter', grade: 'A', status: 'emailed', agent: 'quill' },
  { id: 'l3', business: 'Corner Cycles', category: 'Bike shop', area: 'Old Town', grade: 'B', status: 'new', agent: 'scout' },
  { id: 'l4', business: 'Lantern Dental Studio', category: 'Dental practice', area: 'Hilltop', grade: 'A', status: 'replied', agent: 'echo' },
  { id: 'l5', business: 'Maple Street Cafe', category: 'Cafe', area: 'Market Square', grade: 'B', status: 'emailed', agent: 'quill' },
  { id: 'l6', business: 'Bluebird Florist', category: 'Florist', area: 'Riverside', grade: 'C', status: 'new', agent: 'scout' },
  { id: 'l7', business: 'Stonebridge Physio', category: 'Physiotherapy', area: 'Lakeside', grade: 'B', status: 'checked', agent: 'atlas' },
  { id: 'l8', business: 'Tidewater Print Shop', category: 'Print shop', area: 'Station Road', grade: 'C', status: 'do-not-contact', agent: 'echo' },
  { id: 'l9', business: 'Northlight Accounting', category: 'Accounting', area: 'Market Square', grade: 'B', status: 'new', agent: 'scout' },
  { id: 'l10', business: 'Meadow Pet Care', category: 'Pet care', area: 'Garden Quarter', grade: 'A', status: 'new', agent: 'scout' },
  { id: 'l11', business: 'Copper Kettle Deli', category: 'Deli', area: 'Old Town', grade: 'B', status: 'replied', agent: 'echo' },
  { id: 'l12', business: 'Ironwood Gym', category: 'Gym', area: 'Riverside', grade: 'C', status: 'emailed', agent: 'quill' },
];

export const INBOX: readonly InboxMessage[] = [
  { id: 'm1', from: 'Harbour Bakery <hello@example.co.za>', subject: 'Re: A quick look at your website', cls: 'yes' },
  { id: 'm2', from: 'Green Door Yoga <info@example.com>', subject: 'How much does a new site cost?', cls: 'question', draftId: 'echo-d1' },
  { id: 'm3', from: 'Corner Cycles <sales@example.co.za>', subject: 'Maybe next quarter', cls: 'not-now' },
  { id: 'm4', from: 'Tidewater Print Shop <admin@example.com>', subject: 'Please stop emailing us', cls: 'opt-out' },
  { id: 'm5', from: 'Lantern Dental Studio <bookings@example.co.za>', subject: 'Can you add an online booking button?', cls: 'question', draftId: 'echo-d2' },
  { id: 'm6', from: 'Copper Kettle Deli <orders@example.com>', subject: 'Re: Your note about opening hours', cls: 'yes' },
  { id: 'm7', from: 'Ironwood Gym <team@example.co.za>', subject: 'Not a good time right now', cls: 'not-now' },
  { id: 'm8', from: 'Meadow Pet Care <contact@example.com>', subject: 'Unsubscribe me from this list', cls: 'opt-out' },
];

/** Muse's week: three Instagram, two Facebook and two LinkedIn posts. */
export const SCHEDULE: readonly ScheduleItem[] = [
  { day: 'Monday', channel: 'instagram', hook: 'Three small details that make a shop window feel welcoming' },
  { day: 'Tuesday', channel: 'linkedin', hook: 'What a clear first line in an email changes' },
  { day: 'Wednesday', channel: 'facebook', hook: 'A quick checklist for a page that loads fast on a phone' },
  { day: 'Thursday', channel: 'instagram', hook: 'Before and after: a simple opening-hours fix' },
  { day: 'Friday', channel: 'linkedin', hook: 'Why local businesses win with plain, honest wording' },
  { day: 'Saturday', channel: 'facebook', hook: 'Weekend question: what do your customers ask most?' },
  { day: 'Sunday', channel: 'instagram', hook: 'One idea to plan your week in five minutes' },
];
