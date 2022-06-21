const cors = require('cors')
const bodyParser = require('body-parser')
const express = require('express')
const app = express()

const CognitoExpress = require('cognito-express')
const {getUserPool} = require("fleetmap-partners")
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider')
const client = new CognitoIdentityProviderClient({ region: 'us-east-1' })
const mysql = require('./mysql-reader')
const cognitoByOrigin = {}

function getCognito(origin) {
    if (!cognitoByOrigin[origin]) {
        cognitoByOrigin[origin] = new CognitoExpress({
            region: 'us-east-1',
            cognitoUserPoolId: getUserPool(origin),
            tokenUse: 'id', // Possible Values: access | id
            tokenExpiration: 3600000 // Up to default expiration of 1 hour (3600000 ms)
        })
    }
    return cognitoByOrigin[origin]
}

async function getEmail (origin, accessTokenFromClient) {
    const cognitoExpress = getCognito(origin)
    const cognitoUser = await cognitoExpress.validate(accessTokenFromClient.replace('Bearer ', ''))
    console.log(cognitoUser)
    return cognitoUser.email
}

// noinspection JSCheckFunctionSignatures
app.use(cors({ origin: true, credentials:true, methods: 'GET,PUT,POST,DELETE,OPTIONS' }))
app.use(bodyParser.json())
app.use(async function (req, res, next) {
    const cognitoExpress = getCognito(req.headers.origin)
    const accessTokenFromClient = req.headers.authorization
    if (!accessTokenFromClient) return res.status(401).send('Access Token missing from header')
    const user = await cognitoExpress.validate(accessTokenFromClient.replace('Bearer ', ''))
    const resp = await client.send(new AdminGetUserCommand({Username: user['cognito:username'], UserPoolId: getUserPool(req.headers.origin)}))
    res.locals.user = resp.UserAttributes.find(a => a.Name === 'email').Value
    next()
})
app.get('/', async (req, resp) => {
    try {
        const email = await getEmail(req.headers.origin, req.headers.authorization)
        console.log('Get TachoDownloads User:'+email)
        const sql = `select * from tacho_remotedownload tr 
            inner join tc_users u on traccar.json_extract_c(u.attributes, '$.companyId') = tr.companyid
            inner join tc_user_device td on u.id = td.userid and tr.entityid = td.deviceid
            where u.email = '${email}'`
        resp.json( await mysql.query(sql))
    } catch (e) {
        resp.json({m: e.message})
    }
})
app.get('/tachodownloads/:deviceId', async (req, resp) => {
    try {
        console.log('Get Tacho Downloads by device')
        const deviceId = req.params.deviceId
        const email = getEmail(req.headers.origin, req.headers.authorization)
        console.log(email)
        resp.json( await mysql.query(
            'select * from tacho_remotedownload tr where entityid='+deviceId+' order by requestdate desc limit 10'))
    } catch (e) {
        resp.json({m: e.message})
    }
})

module.exports = app

