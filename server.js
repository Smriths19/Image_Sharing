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

// const { Pool, Client } = require('pg')
// const { password } = require('pg/lib/defaults')
// const connectionString = 'postgresql://postgres:tooLittle19!@localhost:8000/instagram'
// const pool = new Pool({
// connectionString,
// })
 
// const query = {
//     text: 'SELECT * FROM public."User"',
//     types: {
//       getTypeParser: () => val => val,
//     },
//   }

// pool.query(query, (err, res) => {
//   console.log(err, res)
// })


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

app.get('/login', (req, res) => {
    res.render('login')
})

app.get('/register', (req, res) => {
    res.render('register')
})

app.get('/dashboard', (req, res) => {
  //res.render('dashboard', {user: req.user.firstName})
  pool.query(
    `SELECT ph."creationTime", ph.likes, ph.image, ph."mimeType", u."firstName", u."lastName"
    FROM public."Photo" ph, public."User" u
    WHERE ph."userID" = u."userID"
    ORDER BY ph."creationTime" DESC`, (err, results) => {
      if(err) {
        throw err;
      }
       let values = []
       const myArray = results.rows
       myArray.forEach((x, index, array) => {
            const  temp = {data: x.mimeType, img: x.image.toString("base64"), likes: x.likes, timeStamp: x.creationTime, name: x.firstName + " " + x.lastName}
            values.push(temp)
       });

        const temp2 = {user: req.user.firstName, values: values}
        res.render('dashboard', temp2)
    }
  )    
})

// app.get('/logout', (req, res) => {
//     req.logOut();
//     req.flash("success", "You have successfully logged out")
//     res.redirect('/login')
// })

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
                       console.log(results.rows)
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

  const acceptedTypes = ["image/gif", "image/jpeg", "image/png"];

  app.post('/upload', async (req, res) => {
    const userID = req.user.userID;
    const image = req.files.picture;
  if (acceptedTypes.indexOf(image.mimetype) >= 0) {
    console.log(image)
       pool.query(`INSERT INTO public."Photo"
       ("userID", "creationTime", likes, image, "mimeType")
        VALUES ($1, NOW(), 0, $2, $3)`, [userID, image.data, image.mimetype], (err, results) => {
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
