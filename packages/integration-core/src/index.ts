// Connector interfaces (provider-agnostic contracts) and their Mock
// implementations. Real provider adapters (DatevConnector, LexwareConnector,
// MicrosoftMailConnector, GmailConnector, HubspotConnector, TwilioConnector)
// are added per-connector in Phases 7/9/10/11, against official vendor
// documentation only (see docs/INTEGRATIONS.md) — never guessed.
export * from './finance/types';
export * from './finance/mock-finance-connector';
export * from './mail/types';
export * from './mail/mock-mail-connector';
export * from './calendar/types';
export * from './calendar/mock-calendar-connector';
export * from './crm/types';
export * from './crm/mock-crm-connector';
export * from './telephony/types';
export * from './telephony/mock-telephony-connector';
export * from './ocr/types';
export * from './ocr/mock-ocr-provider';
