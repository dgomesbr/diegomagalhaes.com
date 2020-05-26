const {URL} = require('url');
const settingsCache = require('../settings/cache');
const ghostVersion = require('../../lib/ghost-version');
const crypto = require('crypto');
const path = require('path');
const {logging} = require('../../lib/common');
const urlUtils = require('../../lib/url-utils');

const COMPLIMENTARY_PLAN = {
    name: 'Complimentary',
    currency: 'usd',
    interval: 'year',
    amount: '0'
};

// NOTE: the function is an exact duplicate of one in GhostMailer should be extracted
//       into a common lib once it needs to be reused anywhere else again
function getDomain() {
    const domain = urlUtils.urlFor('home', true).match(new RegExp('^https?://([^/:?#]+)(?:[/:?#]|$)', 'i'));
    return domain && domain[1];
}

function getEmailFromAddress() {
    const subscriptionSettings = settingsCache.get('members_subscription_settings') || {};

    return `${subscriptionSettings.fromAddress || 'noreply'}@${getDomain()}`;
}

/** Copied from theme middleware, remove it there after cleanup to keep this in single place */
function getPublicPlans() {
    const CURRENCY_SYMBOLS = {
        USD: '$',
        AUD: '$',
        CAD: '$',
        GBP: '£',
        EUR: '€'
    };
    const defaultPriceData = {
        monthly: 0,
        yearly: 0
    };

    try {
        const membersSettings = settingsCache.get('members_subscription_settings');
        const stripeProcessor = membersSettings.paymentProcessors.find(
            processor => processor.adapter === 'stripe'
        );

        const priceData = stripeProcessor.config.plans.reduce((prices, plan) => {
            const numberAmount = 0 + plan.amount;
            const dollarAmount = numberAmount ? Math.round(numberAmount / 100) : 0;
            return Object.assign(prices, {
                [plan.name.toLowerCase()]: dollarAmount
            });
        }, {});

        priceData.currency = String.prototype.toUpperCase.call(stripeProcessor.config.currency || 'usd');
        priceData.currency_symbol = CURRENCY_SYMBOLS[priceData.currency];

        if (Number.isInteger(priceData.monthly) && Number.isInteger(priceData.yearly)) {
            return priceData;
        }

        return defaultPriceData;
    } catch (err) {
        return defaultPriceData;
    }
}

const getApiUrl = ({version, type}) => {
    const {href} = new URL(
        urlUtils.getApiPath({version, type}),
        urlUtils.urlFor('admin', true)
    );
    return href;
};

const siteUrl = urlUtils.getSiteUrl();
const membersApiUrl = getApiUrl({version: 'v3', type: 'members'});

function getStripePaymentConfig() {
    const subscriptionSettings = settingsCache.get('members_subscription_settings');

    const stripePaymentProcessor = subscriptionSettings.paymentProcessors.find(
        paymentProcessor => paymentProcessor.adapter === 'stripe'
    );

    if (!stripePaymentProcessor || !stripePaymentProcessor.config) {
        return null;
    }

    if (!stripePaymentProcessor.config.public_token || !stripePaymentProcessor.config.secret_token) {
        return null;
    }

    // NOTE: "Complimentary" plan has to be first in the queue so it is created even if regular plans are not configured
    stripePaymentProcessor.config.plans.unshift(COMPLIMENTARY_PLAN);

    const webhookHandlerUrl = new URL('/members/webhooks/stripe', siteUrl);

    const checkoutSuccessUrl = new URL(siteUrl);
    checkoutSuccessUrl.searchParams.set('stripe', 'success');
    const checkoutCancelUrl = new URL(siteUrl);
    checkoutCancelUrl.searchParams.set('stripe', 'cancel');

    const billingSuccessUrl = new URL(siteUrl);
    billingSuccessUrl.searchParams.set('stripe', 'billing-update-success');
    const billingCancelUrl = new URL(siteUrl);
    billingCancelUrl.searchParams.set('stripe', 'billing-update-cancel');

    return {
        publicKey: stripePaymentProcessor.config.public_token,
        secretKey: stripePaymentProcessor.config.secret_token,
        checkoutSuccessUrl: checkoutSuccessUrl.href,
        checkoutCancelUrl: checkoutCancelUrl.href,
        billingSuccessUrl: billingSuccessUrl.href,
        billingCancelUrl: billingCancelUrl.href,
        webhookHandlerUrl: webhookHandlerUrl.href,
        product: stripePaymentProcessor.config.product,
        plans: stripePaymentProcessor.config.plans,
        appInfo: {
            name: 'Ghost',
            partner_id: 'pp_partner_DKmRVtTs4j9pwZ',
            version: ghostVersion.original,
            url: 'https://ghost.org/'
        }
    };
}

function getAuthSecret() {
    const hexSecret = settingsCache.get('members_email_auth_secret');
    if (!hexSecret) {
        logging.warn('Could not find members_email_auth_secret, using dynamically generated secret');
        return crypto.randomBytes(64);
    }
    const secret = Buffer.from(hexSecret, 'hex');
    if (secret.length < 64) {
        logging.warn('members_email_auth_secret not large enough (64 bytes), using dynamically generated secret');
        return crypto.randomBytes(64);
    }
    return secret;
}

function getAllowSelfSignup() {
    const subscriptionSettings = settingsCache.get('members_subscription_settings');
    return subscriptionSettings.allowSelfSignup;
}

function getTokenConfig() {
    return {
        issuer: membersApiUrl,
        publicKey: settingsCache.get('members_public_key'),
        privateKey: settingsCache.get('members_private_key')
    };
}

function getSigninURL(token, type) {
    const signinURL = new URL(siteUrl);
    signinURL.pathname = path.join(signinURL.pathname, '/members/');
    signinURL.searchParams.set('token', token);
    signinURL.searchParams.set('action', type);
    return signinURL.href;
}

module.exports = {
    getEmailFromAddress,
    getPublicPlans,
    getStripePaymentConfig,
    getAllowSelfSignup,
    getAuthSecret,
    getTokenConfig,
    getSigninURL
};
