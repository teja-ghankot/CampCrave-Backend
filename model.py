from flask import Flask, request, jsonify
from pymongo import MongoClient
import pandas as pd
from surprise import Dataset, Reader, SVD
from surprise.model_selection import train_test_split

app = Flask(__name__)

# MongoDB setup
client = MongoClient("mongodb+srv://teja:teja2005@cluster0.yccd7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
db = client.test

def train_model():
    orders = db.orders.find()
    data = []
    for order in orders:
        user_id = str(order['userId'])
        for item in order['items']:
            data.append((user_id, item))
    df = pd.DataFrame(data, columns=['userId', 'itemId'])
    df = df.groupby(['userId', 'itemId']).size().reset_index(name='rating')
    df['rating'] = df['rating'].clip(upper=5)

    reader = Reader(rating_scale=(1, 5))
    data = Dataset.load_from_df(df[['userId', 'itemId', 'rating']], reader)
    trainset, testset = train_test_split(data, test_size=0.2)
    model = SVD()
    model.fit(trainset)
    return model, df

def get_popular_items(df, top_n=5):
    popular_counts = df.groupby('itemId')['rating'].sum().sort_values(ascending=False)
    top_items = popular_counts.head(top_n).index.tolist()
    return top_items

# Train model once on startup
model, df = train_model()

@app.route('/recommend/<user_id>', methods=['GET'])
def recommend(user_id):
    user_items = df[df['userId'] == user_id]['itemId'].unique()

    if len(user_items) == 0:
        # New user: recommend popular items
        popular_items = get_popular_items(df)
        results = [{"itemId": item, "score": None} for item in popular_items]
    else:
        # Existing user: personalized predictions
        all_items = df['itemId'].unique()
        unseen_items = [item for item in all_items if item not in user_items]
        predictions = [(item, model.predict(user_id, item).est) for item in unseen_items]
        top_items = sorted(predictions, key=lambda x: -x[1])[:5]
        results = [{"itemId": item, "score": round(score, 2)} for item, score in top_items]

    return jsonify({"userId": user_id, "recommendations": results})

if __name__ == '__main__':
    # CHANGED: Added host='0.0.0.0' to accept external connections
    app.run(host='0.0.0.0', debug=True)