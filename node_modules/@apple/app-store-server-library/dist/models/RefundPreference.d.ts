/**
 * A value that indicates your preferred outcome for the refund request.
 *
 * {@link https://developer.apple.com/documentation/appstoreserverapi/refundpreference refundPreference}
 */
export declare enum RefundPreference {
    UNDECLARED = 0,
    PREFER_GRANT = 1,
    PREFER_DECLINE = 2,
    NO_PREFERENCE = 3
}
