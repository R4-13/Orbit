/**
 * Obergrenze für Listen-Endpunkte ohne Seitenwechsel. Die Übersichten der Oberfläche sind eigene, begrenzte Abfragen; diese einfachen Listen dienen der Schnittstelle
 * und kleineren Auswahlfeldern. Ohne Grenze würde ein Mandant mit zehntausenden Datensätzen bei jedem Aufruf alles laden und übertragen.
 */
export const LIST_HARD_LIMIT = 1000;
