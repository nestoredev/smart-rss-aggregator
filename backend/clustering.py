import math
import re

# Stop words to filter out noise from similarities
STOP_WORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', "aren't", 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', "can't", 'cannot', 'could',
    "couldn't", 'did', "didn't", 'do', 'does', "doesn't", 'doing', "don't", 'down', 'during', 'each', 'few', 'for',
    'from', 'further', 'had', "hadn't", 'has', "hasn't", 'have', "haven't", 'having', 'he', "he'd", "he'll", "he's",
    'her', 'here', "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how', "how's", 'i', "i'd", "i'll", "i'm",
    "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its', 'itself', "let's", 'me', 'more', 'most', "mustn't",
    'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'same', "shan't", 'she', "she'd", "she'll", "she's", 'should', "shouldn't",
    'so', 'some', 'such', 'than', 'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
    "there's", 'these', 'they', "they'd", "they'll", "they're", "they've", 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', "wasn't", 'we', "we'd", "we'll", "we're", "we've", 'were', "weren't",
    'what', "what's", 'when', "when's", 'where', "where's", 'which', 'while', 'who', "who's", 'whom', 'why',
    "why's", 'with', "won't", 'would', "wouldn't", 'you', "you'd", "you'll", "you're", "you've", 'your', 'yours',
    'yourself', 'yourselves'
}

def tokenize(text):
    """Normalize and clean text into a list of word tokens, filtering out stop words."""
    if not text:
        return []
    text = text.lower()
    # Remove HTML tags if any remain
    text = re.sub(r'<[^>]*>', '', text)
    # Remove punctuation
    text = re.sub(r'[^\w\s\-]', '', text)
    # Split on whitespace
    tokens = text.split()
    return [t for t in tokens if t not in STOP_WORDS and len(t) > 1]

def get_tf(tokens):
    """Calculate Term Frequency for a list of tokens."""
    if not tokens:
        return {}
    tf = {}
    for t in tokens:
        tf[t] = tf.get(t, 0) + 1
    total = len(tokens)
    return {t: count / total for t, count in tf.items()}

def cluster_articles(articles, threshold=0.35):
    """
    Groups a list of article dicts (containing 'title' and 'summary') based on text similarity.
    Uses TF-IDF representation and Cosine Similarity, then groups them using single-linkage agglomerative clustering.
    
    Returns a list of lists, where each nested list contains article dicts belonging to the same cluster.
    """
    if not articles:
        return []
    
    if len(articles) == 1:
        return [[articles[0]]]

    # Prepare document tokens. Title is duplicated to give it double weight.
    docs_tokens = []
    for art in articles:
        title = art.get('title', '')
        summary = art.get('summary', '')
        combined = f"{title} {title} {summary}"
        docs_tokens.append(tokenize(combined))

    num_docs = len(articles)
    all_terms = set(term for tokens in docs_tokens for term in tokens)
    
    # Calculate Document Frequency (DF) for IDF calculation
    doc_contains = {}
    for term in all_terms:
        doc_contains[term] = sum(1 for tokens in docs_tokens if term in tokens)

    # Compute smoothed IDF
    idf = {}
    for term in all_terms:
        idf[term] = math.log(1 + (num_docs / (1 + doc_contains[term])))

    # Compute TF-IDF vectors for each document
    tfidf_vectors = []
    for tokens in docs_tokens:
        tf = get_tf(tokens)
        vector = {}
        for term, tf_val in tf.items():
            vector[term] = tf_val * idf.get(term, 0.0)
        tfidf_vectors.append(vector)

    def cosine_similarity(v1, v2):
        """Calculate the cosine similarity between two TF-IDF dictionary vectors."""
        dot_product = sum(v1[t] * v2[t] for t in v1 if t in v2)
        mag1 = math.sqrt(sum(val**2 for val in v1.values()))
        mag2 = math.sqrt(sum(val**2 for val in v2.values()))
        if mag1 == 0.0 or mag2 == 0.0:
            return 0.0
        return dot_product / (mag1 * mag2)

    # Initialize each document as its own cluster
    # Format: list of lists of document indices
    clusters = [[i] for i in range(num_docs)]

    while len(clusters) > 1:
        best_sim = -1.0
        merge_i, merge_j = -1, -1

        # Compare all pairs of clusters
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                # Maximum pair-wise similarity between cluster elements (single-linkage)
                max_pair_sim = -1.0
                for idx_a in clusters[i]:
                    for idx_b in clusters[j]:
                        sim = cosine_similarity(tfidf_vectors[idx_a], tfidf_vectors[idx_b])
                        if sim > max_pair_sim:
                            max_pair_sim = sim

                if max_pair_sim > best_sim:
                    best_sim = max_pair_sim
                    merge_i = i
                    merge_j = j

        # If similarity exceeds threshold, merge the clusters
        if best_sim >= threshold and merge_i != -1:
            clusters[merge_i].extend(clusters[merge_j])
            clusters.pop(merge_j)
        else:
            # No clusters are similar enough to merge
            break

    # Translate cluster indices back into lists of article dicts
    clustered_result = []
    for c in clusters:
        group = [articles[idx] for idx in c]
        clustered_result.append(group)

    return clustered_result
