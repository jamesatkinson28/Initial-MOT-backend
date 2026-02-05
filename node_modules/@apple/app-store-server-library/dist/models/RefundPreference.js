"use strict";
// Copyright (c) 2024 Apple Inc. Licensed under MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefundPreference = void 0;
/**
 * A value that indicates your preferred outcome for the refund request.
 *
 * {@link https://developer.apple.com/documentation/appstoreserverapi/refundpreference refundPreference}
 */
var RefundPreference;
(function (RefundPreference) {
    RefundPreference[RefundPreference["UNDECLARED"] = 0] = "UNDECLARED";
    RefundPreference[RefundPreference["PREFER_GRANT"] = 1] = "PREFER_GRANT";
    RefundPreference[RefundPreference["PREFER_DECLINE"] = 2] = "PREFER_DECLINE";
    RefundPreference[RefundPreference["NO_PREFERENCE"] = 3] = "NO_PREFERENCE";
})(RefundPreference || (exports.RefundPreference = RefundPreference = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmVmdW5kUHJlZmVyZW5jZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL21vZGVscy9SZWZ1bmRQcmVmZXJlbmNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0REFBNEQ7OztBQUU1RDs7OztHQUlHO0FBQ0gsSUFBWSxnQkFLWDtBQUxELFdBQVksZ0JBQWdCO0lBQ3hCLG1FQUFjLENBQUE7SUFDZCx1RUFBZ0IsQ0FBQTtJQUNoQiwyRUFBa0IsQ0FBQTtJQUNsQix5RUFBaUIsQ0FBQTtBQUNyQixDQUFDLEVBTFcsZ0JBQWdCLGdDQUFoQixnQkFBZ0IsUUFLM0IiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgKGMpIDIwMjQgQXBwbGUgSW5jLiBMaWNlbnNlZCB1bmRlciBNSVQgTGljZW5zZS5cblxuLyoqXG4gKiBBIHZhbHVlIHRoYXQgaW5kaWNhdGVzIHlvdXIgcHJlZmVycmVkIG91dGNvbWUgZm9yIHRoZSByZWZ1bmQgcmVxdWVzdC5cbiAqXG4gKiB7QGxpbmsgaHR0cHM6Ly9kZXZlbG9wZXIuYXBwbGUuY29tL2RvY3VtZW50YXRpb24vYXBwc3RvcmVzZXJ2ZXJhcGkvcmVmdW5kcHJlZmVyZW5jZSByZWZ1bmRQcmVmZXJlbmNlfVxuICovXG5leHBvcnQgZW51bSBSZWZ1bmRQcmVmZXJlbmNlIHtcbiAgICBVTkRFQ0xBUkVEID0gMCxcbiAgICBQUkVGRVJfR1JBTlQgPSAxLFxuICAgIFBSRUZFUl9ERUNMSU5FID0gMixcbiAgICBOT19QUkVGRVJFTkNFID0gMyxcbn1cbiJdfQ==