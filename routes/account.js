var express = require("express"),
    Ajv = require("ajv")
    crypto = require("crypto"),
    jwt = require("jsonwebtoken");

var config = require("../config"),
    error = require("../utilities/error"),
    auth = require("../utilities/authenticator"),
    models = require("../models");

var ajv = new Ajv();
var accountSchema = {
  "properties":{
    "username":{"$ref":"/username"},
    "password":{"$ref":"/password"},
  },
  "required":["username", "password"]
};

var usernameSchema = {
  "type":"string",
  "minLength":1,
  "maxLength":20
}

var passwordSchema = {
  "type":"string",
  "minimum":6
}

ajv.addSchema(usernameSchema, "/username");
ajv.addSchema(passwordSchema, "/password");

var router = express.Router();

router.post("/login", function(req, res, next){
  var data = req.body;
  var valid = ajv.validate(accountSchema, data);
  if(!valid)
    return next(new error.BadRequest("Bad parameter: " + ajv.errorsText()));

  models.User.findOne({where: {username: data.username}}).then(function(user){
    if(!user)
      throw new error.Unauthorized("Incorrect username or password.");

    //TODO: Look into storing a token salt with users data to allow for manual invalidation of tokens.
    //Also: consider adjusting expiration timer. Spec: https://tools.ietf.org/id/draft-ietf-oauth-jwt-bearer-05.html
    var key = crypto.pbkdf2Sync(data.password, user.salt, 100000, 64, "sha512");
    if(key.toString("hex") == user.password){ //We have a match.
      var token = jwt.sign({userid:user.id, salt:user.token_salt}, config.secret, {expiresIn:"30d"});
      res.status(200).json({status:200, result:token});
    }else{
      throw new error.Unauthorized("Incorrect username or password.");
    }
  }).catch(next);
});

router.post("/register", function(req, res, next){
  var data = req.body;
  var valid = ajv.validate(accountSchema, data);
  if(!valid)
    return next(new error.BadRequest("Bad parameter: " + ajv.errorsText()));

  models.User.findOne({where: {username: data.username}}).then(function(user){
    if(user)
      throw new error.Conflict("Account already exists with username: " + data.username);

    var salt = crypto.randomBytes(16).toString("hex");
    var token_salt = crypto.randomBytes(16).toString("hex");
    var key = crypto.pbkdf2Sync(data.password, salt, 100000, 64, "sha512").toString("hex");
    models.User.create({username: data.username, password: key, salt: salt, token_salt: token_salt}).then(function(){
      res.status(201).json({status:201, result:"Successfully created account."});
    });
  }).catch(next);
});

router.post("/logout", auth, function(req, res, next){
  models.User.findOne({where: {id: req.token_data.userid}}).then(function(user){
    //This technically doesn't guarantee invalidation. It may be better to store
    //an integer to be incremented on logout.
    var token_salt = crypto.randomBytes(16).toString("hex");
    user.update({token_salt: token_salt}).then(function(){
      res.status(200).json({status:200, result:"Invalidated existing tokens."});
    });
  }).catch(next);
});

router.post("/checktoken", auth, function(req, res, next){
  res.status(200).json({status:200, result:"Token is valid."});
});

router.post("/lots", auth, function(req, res, next){
  var data = req.body;

  models.Lot.findAll({where:{UserId: req.token_data.userid}})
  .then(function(lots){
    if(lots.length != 0){
      res.json({status:"200", result:lots});
    }else{
      return next(new error.NotFound("No lots for user"));
    }
  }).catch(next);
});

module.exports = router;
