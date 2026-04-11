# Public Website Deployment

This project is ready to go live as a public website with:

- Render for hosting the Node.js app
- MongoDB Atlas for the database

## 1. Create MongoDB Atlas

1. Create a MongoDB Atlas account.
2. Create a free cluster.
3. Create a database user.
4. In `Network Access`, allow the Render service to connect.
5. Copy the connection string and replace the username and password.

Example:

```text
mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net/pharmacy
```

## 2. Upload This Project To GitHub

1. Create a new GitHub repository.
2. Upload this project.
3. Do not upload `.env`.
4. Keep `.env.example` as the safe reference file.

## 3. Deploy On Render

1. Sign in to Render.
2. Click `New +`.
3. Choose `Blueprint`.
4. Connect your GitHub account and select this repository.
5. Render will detect [render.yaml](C:/Users/udity/pharmacy-app/render.yaml).
6. Set `MONGO_URI` to your Atlas connection string.
7. Deploy.

The Render service is configured as:

- service name: `lumiere-de-vie-pharma`
- start command: `npm start`
- health check: `/health`

## 4. Open Your Public Website

After deployment, Render will give you a public URL like:

```text
https://lumiere-de-vie-pharma.onrender.com
```

Open that URL on:

- PC browsers
- mobile browsers
- the APK `Server URL` field

## 5. After First Deploy

For security, change these Render environment variables:

- `OWNER_PASSWORD`
- `STAFF_PASSWORD`
- optionally `OWNER_USERNAME` and `STAFF_USERNAME`

## Notes

- Free hosting plans can have limitations and sleep behavior.
- If you want a cleaner mobile experience later, I can remove the APK `Server URL` field and hardcode your deployed public URL after you share it with me.
