const express = require('express')
const app = express()
const PORT = 3000
const bcrypt = require('bcrypt')
const session = require('express-session')
const flash = require('express-flash')
const passport = require('passport')
require('dotenv').config()
const { pool } = require('./dbConfig')
const fileUpload = require("express-fileupload");

const initializePassport = require('./configPassport')

initializePassport(passport);


//middlewares
app.set('view engine', 'ejs')
app.use(express.static("public"));  
app.use(express.urlencoded({ extended: false }))

app.use(session({
  secret: "secret",
  resave: false,
  saveUninitialized: false
}))

//middleware for passport
app.use(passport.initialize())
app.use(passport.session())

app.use(flash())

app.use(
  fileUpload({
    limits: {
      fileSize: 2000000, // Around 2MB
    },
    abortOnLimit: true,
    limitHandler: fileTooBig,
  })
  );


app.get('/', (req, res) => {
  res.render('index')
})

app.get('/login', checkAuthenticated, (req, res) => {
  res.render('login')
})

app.get('/register', checkAuthenticated, (req, res) => {
  res.render('register')
})

app.get('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    req.flash("success", "You have successfully logged out")
    res.redirect('/login');
  });
});

app.get('/dashboard', checkNotAuthenticated, async (req, res) => {

  const result = await fetchDashboard(req.user.userID)

  const dashboard = {user: req.user.firstName + " " + req.user.lastName, username: req.user.firstName, values: result}

  res.render('dashboard', dashboard)

})

async function fetchDashboard(loggedInUserID) {

  let values = []

  const result = await pool.query(
    `SELECT ph."photoID", ph."creationTime", (SELECT count(upm."userID") FROM public."UserPhotoMapping" upm
    WHERE upm."photoID" = ph."photoID") likes, ph.image, ph."mimeType", u."userID", u."firstName", u."lastName", CASE when upm."photoID" ISNULL THEN false ELSE true END isLiked 
    FROM public."User" u, public."Photo" ph
    LEFT JOIN public."UserPhotoMapping" upm ON ph."photoID" = upm."photoID" AND upm."userID" = $1
    WHERE ph."userID" = u."userID"
    ORDER BY ph."creationTime" DESC`, [loggedInUserID])

  const myArray = result.rows

  for(const x of myArray) {
    values.push(await fetchImage(x))
  }

  return values
}

async function fetchImage(x) {
  const comment = await fetchComments(x.photoID)
  const imageInfo = {comment: comment, isLiked: x.isliked, photoid: x.photoID, userid: x.userID, data: x.mimeType, img: x.image.toString("base64"), likes: x.likes, timeStamp: x.creationTime, name: x.firstName + " " + x.lastName}
  return imageInfo
}

async function fetchComments(photoid) {
  const res = await pool.query(
    `SELECT cmt."commentStr", cmt."createdTime", u."firstName" || ' ' || u."lastName" fullName
    FROM public."Comments" cmt, public."User" u
    WHERE cmt."userID" = u."userID"
    AND cmt."photoID" = $1  
    ORDER BY cmt."createdTime" DESC`, [photoid]
    )
  return res.rows
}

app.post('/like', (req, res) => {
  let body = req.body
  let userid = req.user.userID
  let photoid = body.photoID
  let isLiked = body.like
  if(isLiked) {
    pool.query(
      `DELETE FROM public."UserPhotoMapping" upm
      WHERE upm."userID" = $1 AND upm."photoID" = $2`
    ), [userid, photoid], (err) => {
      if(err) {
        throw err;
      }
           console.log(results.rows)
    }
  }
  else {
    pool.query(
      `INSERT INTO public."UserPhotoMapping"(
        "userID", "photoID")
        VALUES ($1, $2)`, [userid, photoid], (err) => {
          if(err) {
            throw err;
          }
               //console.log(results.rows)
        }
    )
  }
})


app.post('/comment', (req, res) => {
  let body = req.body
  const photoid = body.photoid
  const comment = body.comment
  const userid = req.user.userID

  pool.query(
    `INSERT INTO public."Comments"("photoID", "userID", "commentStr", "createdTime")
    VALUES ($1, $2, $3, NOW())`, 
    [photoid, userid, comment], (err) => {
     if(err) {
       throw err;
     }
          //console.log(results.rows)
   }
   )
})


app.post('/register', async (req, res) => {
  let { firstName, lastName, email, password, password2 } = req.body

 // console.log({firstName, lastName, email, password, password2})

  let errors = [];

  if(!firstName || !lastName || !email || !password || !password2)
  {
    errors.push({ message: "Please enter all fields" })
  }

  if(password.length < 5) {
    errors.push({ message: "Password should be at least 6 characters"})
  }

  if(password != password2) {
    errors.push({ message: "Passwords do not match"})
  }  

  if(errors.length > 0) {
    res.render('register', {errors })
  }
  else {
      //Form validation complete
    let passwordHashed = await bcrypt.hash(password, 10)
     // console.log(passwordHashed)
    
    pool.query(
      `SELECT * FROM public."User"
      WHERE email = $1`, [email], (error, results)=> {
        if(error) {
          throw error
        }
       //   console.log(results.rows)
        if(results.rows.length > 0) {
          errors.push({ message: "Email already registered" }) 
          res.render('register', {errors})
        }
        else {
          pool.query(
            `INSERT INTO public."User" ("firstName", "lastName", email, "passwordHash")
            VALUES ($1, $2, $3, $4)`, 
            [firstName, lastName, email, passwordHashed], (err, results) => {
              if(err) {
                throw err;
              }
                      //console.log(results.rows)
              req.flash("success", "You are now a registered member. You can now log in.")
              res.redirect('/login')
            }  
            )
        }
      }
      )
  }
})

app.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/login',
  failureFlash: true
})
)

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('dashboard')
  }
  next();
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.redirect('/login')
}

const acceptedTypes = ["image/gif", "image/jpg", "image/png"];

app.post('/upload', async (req, res) => {
  const userID = req.user.userID;
  const image = req.files.picture;
  if (acceptedTypes.indexOf(image.mimetype) >= 0) {
    console.log(image)
    pool.query(`INSERT INTO public."Photo"
     ("userID", "creationTime", image, "mimeType")
     VALUES ($1, NOW(), $2, $3)`, [userID, image.data, image.mimetype], (err, results) => {
      if(err) {
        throw err;
      }
      console.log(results.rows)
    } )
  }
  else {
    req.flash("error", "Uploaded image type cannot be identified")
    res.redirect('/dashboard')
  }
  res.redirect('/dashboard')

})

function fileTooBig(req, res, next) {
  res.render("dashboard.ejs", {
    name: "",
    messages: { error: "Filesize too large" },
  });
}


app.listen(PORT, ()=> {
  console.log("Listening...")
})
