import { SetMetadata } from '@nestjs/common';

export const PASSWORD_PENDING_KEY = 'orbit:allowWhilePasswordChangePending';

/** Auf Endpunkten erlaubt, die auch mit Startpasswort nutzbar sein müssen: Passwortwechsel, Kontoabfrage. */
export const AllowWhilePasswordChangePending = () => SetMetadata(PASSWORD_PENDING_KEY, true);
